#include <cstddef>
#include <cstring>
#include <exception>
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "../rs/cache/CacheIndex.hpp"
#include "../rs/cache/CacheSystem.hpp"
#include "../rs/cache/CacheType.hpp"
#include "../rs/cache/store/CacheStore.hpp"
#include "../rs/cache/store/DatLayout.hpp"
#include "../rs/cache/format/Archive.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/compression/CompressionType.hpp"
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
#include "../rs/config/defaults/GraphicsDefaults.hpp"
#include "../rs/config/vartype/client/VarClientIntTypeLoader.hpp"
#include "../rs/config/vartype/client/VarClientStrTypeLoader.hpp"
#include "../rs/config/vartype/player/VarPlayerTypeLoader.hpp"
#include "../rs/types.hpp"
#include "../rs/sprite/SpriteLoader.hpp"
#include "../rs/texture/SpriteTextureLoader.hpp"
#include "../rs/texture/DatTextureLoader.hpp"
#include "../rs/texture/OldProceduralTextureLoader.hpp"
#include "../rs/io/Uint8ArrayReader.hpp"
#include "../rs/texture/procedural/ProceduralTexture.hpp"
#include "../rs/texture/procedural/ProceduralSources.hpp"
#include "../rs/texture/procedural/TextureGenerator.hpp"
#include "../rs/util/ColorUtil.hpp"
#include "../rs/util/StringHash.hpp"
#include "../rs/loaders/OldConfigLoaders.hpp"
#include "../rs/map/TerrainSquare.hpp"
#include "../rs/map/TerrainSquareDecode.hpp"

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

static void appendU16BE(std::vector<rs::u8>& out, rs::u16 v) {
    out.push_back(static_cast<rs::u8>((v >> 8) & 0xFFu));
    out.push_back(static_cast<rs::u8>(v & 0xFFu));
}

static void appendI32BE(std::vector<rs::u8>& out, rs::i32 v) {
    const rs::u32 u = static_cast<rs::u32>(v);
    out.push_back(static_cast<rs::u8>((u >> 24) & 0xFFu));
    out.push_back(static_cast<rs::u8>((u >> 16) & 0xFFu));
    out.push_back(static_cast<rs::u8>((u >> 8) & 0xFFu));
    out.push_back(static_cast<rs::u8>(u & 0xFFu));
}

static void appendU24BE(std::vector<rs::u8>& out, rs::u32 v) {
    out.push_back(static_cast<rs::u8>((v >> 16) & 0xFFu));
    out.push_back(static_cast<rs::u8>((v >> 8) & 0xFFu));
    out.push_back(static_cast<rs::u8>(v & 0xFFu));
}

static std::vector<rs::u8> makeContainerNone(const std::vector<rs::u8>& payload) {
    std::vector<rs::u8> out;
    out.reserve(5 + payload.size());
    out.push_back(static_cast<rs::u8>(rs::CompressionType::None));
    appendI32BE(out, static_cast<rs::i32>(payload.size()));
    out.insert(out.end(), payload.begin(), payload.end());
    return out;
}

static rs::i32 fnv1a32Ints(const rs::Span<const rs::i32> ints) {
    rs::u32 h = 0x811C9DC5u;
    for (std::size_t i = 0; i < ints.size(); i++) {
        rs::u32 v = static_cast<rs::u32>(ints[i]);
        h ^= v & 0xFFu;
        h *= 0x01000193u;
        h ^= (v >> 8) & 0xFFu;
        h *= 0x01000193u;
        h ^= (v >> 16) & 0xFFu;
        h *= 0x01000193u;
        h ^= (v >> 24) & 0xFFu;
        h *= 0x01000193u;
    }
    return static_cast<rs::i32>(h);
}

static int testTerrainHeightsGoldenOldFormat(rs::Allocator& alloc) {
    rs::TerrainSquare square{};
    auto rr = square.init(alloc);
    if (!rr.isOk()) {
        return fail("TerrainSquare.init failed");
    }

    const std::size_t totalBytes =
        static_cast<std::size_t>(rs::TerrainConstants::MAX_LEVELS) *
        static_cast<std::size_t>(rs::TerrainConstants::MAP_SQUARE_SIZE) *
        static_cast<std::size_t>(rs::TerrainConstants::MAP_SQUARE_SIZE);

    rs::Vec<rs::u8> data(alloc);
    rr = data.resize(totalBytes);
    if (!rr.isOk()) {
        return fail("terrain data alloc failed");
    }
    for (std::size_t i = 0; i < data.size(); i++) {
        data[i] = 0;
    }

    const rs::Status s = rs::decodeTerrainSquareFromBytesInto(
        square,
        rs::Span<const rs::u8>(data.data(), data.size()),
        /*newTerrainFormat=*/false,
        /*worldTileX0=*/0,
        /*worldTileY0=*/0
    );
    if (!rs::ok(s)) {
        return fail("decodeTerrainSquareFromBytesInto failed");
    }

    // Mirrors TS goldens in `scripts/cache/decode-invariants.ts`.
    if (square.height(0, 0, 0) != -312) return fail("terrain golden mismatch: [0][0][0]");
    if (square.height(0, 1, 0) != -312) return fail("terrain golden mismatch: [0][1][0]");
    if (square.height(0, 0, 1) != -352) return fail("terrain golden mismatch: [0][0][1]");
    if (square.height(0, 63, 63) != -240) return fail("terrain golden mismatch: [0][63][63]");

    if (square.height(1, 0, 0) != -552) return fail("terrain golden mismatch: [1][0][0]");
    if (square.height(2, 0, 0) != -792) return fail("terrain golden mismatch: [2][0][0]");
    if (square.height(3, 0, 0) != -1032) return fail("terrain golden mismatch: [3][0][0]");

    return 0;
}

// Builds a minimal Dat2 reference table (protocol=5, unnamed, no whirlpool) with:
// - 1 archive at `archiveId`
// - 1 file at `fileId` within that archive
static std::vector<rs::u8> makeRefTableProtocol5SingleArchiveSingleFile(rs::u16 archiveId, rs::u16 fileId) {
    std::vector<rs::u8> out;
    out.reserve(2 + 2 + 2 + 4 + 4 + 2 + 2);
    out.push_back(5); // protocol
    out.push_back(0); // flags: unnamed, no whirlpool

    appendU16BE(out, 1);         // archiveCount
    appendU16BE(out, archiveId); // archiveId delta

    appendI32BE(out, 0); // crc
    appendI32BE(out, 0); // revision

    appendU16BE(out, 1);      // fileCount
    appendU16BE(out, fileId); // fileId delta

    return out;
}

class FakeStore final : public rs::CacheStore {
public:
    std::size_t idxSize = 0;
    std::vector<rs::u8> datArchive0;
    std::vector<rs::u8> datArchive1;
    std::vector<rs::u8> dat2Meta; // meta index (255), archive id = index id
    std::map<rs::i32, std::vector<rs::u8>> dat2MetaByIndexId;
    std::map<std::pair<rs::i32, rs::i32>, std::vector<rs::u8>> archivesByIndexAndArchiveId;

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
            const auto it = dat2MetaByIndexId.find(archiveId);
            src = (it != dat2MetaByIndexId.end()) ? &it->second : &dat2Meta;
        } else {
            const auto it = archivesByIndexAndArchiveId.find(std::make_pair(indexId, archiveId));
            if (it != archivesByIndexAndArchiveId.end()) {
                src = &it->second;
            } else if (archiveId == 0) {
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

class FakeTextureSource final : public rs::ITextureSource {
public:
    bool small = false;
    rs::i32 id = 0;
    rs::i32 width = 0;
    rs::i32 height = 0;
    std::vector<rs::i32> pixels; // ARGB

    [[nodiscard]] bool isSmall(rs::i32 textureId) const noexcept override {
        (void)textureId;
        return small;
    }

    rs::Status tryLoadTexturePixelsRgb(
        rs::i32 textureId,
        rs::i32 sizeHint,
        rs::TexturePixels* out,
        rs::Allocator& alloc) const noexcept override {
        (void)sizeHint;
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        if (textureId != id) {
            return rs::Status::NotFound;
        }
        out->pixels = rs::Vec<rs::i32>(alloc);
        auto rr = out->pixels.resize(pixels.size());
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < pixels.size(); i++) {
            out->pixels[i] = pixels[i];
        }
        out->width = width;
        out->height = height;
        return rs::Status::Ok;
    }
};

class FakeSpriteSource final : public rs::ISpriteSource {
public:
    rs::i32 id = 0;
    rs::i32 width = 0;
    rs::i32 height = 0;
    std::vector<rs::i32> pixels; // ARGB

    rs::Status tryLoadSpritePixelsArgb(rs::i32 spriteId, rs::SpritePixels* out, rs::Allocator& alloc) const noexcept override {
        if (!out) {
            return rs::Status::InvalidArgument;
        }
        if (spriteId != id) {
            return rs::Status::NotFound;
        }
        out->pixels = rs::Vec<rs::i32>(alloc);
        auto rr = out->pixels.resize(pixels.size());
        if (!rr.isOk()) {
            return rr.status();
        }
        for (std::size_t i = 0; i < pixels.size(); i++) {
            out->pixels[i] = pixels[i];
        }
        out->width = width;
        out->height = height;
        return rs::Status::Ok;
    }
};

static int test_gzip(rs::Allocator& alloc, rs::NativeCompressionHandler& compression) {
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

    return 0;
}

static int test_cache_index_and_system(rs::Allocator& alloc, rs::NativeCompressionHandler& compression) {
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

    return 0;
}

} // namespace

namespace {

static int test_varbit_type_loaders(rs::Allocator& alloc, rs::NativeCompressionHandler& compression) {
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
        // Config decode: VarBitType (opcode=1) + index-backed loader (RS2 index configs, fileIdBits=10).
        const rs::CacheInfo cacheInfo{
            .name = "test",
            .game = rs::GameType::Runescape,
            .environment = "test",
            .revision = 500,
            .timestamp = "1970-01-01",
            .size = 0,
        };

        FakeStore store;

        // Dat2 meta for index id 22: one archive (0) with one file (0).
        const rs::i32 varbitsIndexId = 22;
        store.dat2MetaByIndexId[varbitsIndexId] = makeContainerNone(makeRefTableProtocol5SingleArchiveSingleFile(0, 0));

        // Archive 0 payload: [opcode=1][baseVar=u16][start=u8][end=u8][opcode=0]
        const std::vector<rs::u8> payload = {1, 0x01, 0x23, 4, 9, 0};
        store.archivesByIndexAndArchiveId[std::make_pair(varbitsIndexId, 0)] = makeContainerNone(payload);

        auto idxRes = rs::CacheIndex::fromStore(rs::CacheType::Dat2, varbitsIndexId, store, compression, alloc);
        if (!idxRes.isOk()) {
            return fail("VarBitType: CacheIndex::fromStore(Dat2) expected Ok");
        }
        rs::CacheIndex idx = rs::move(idxRes.value());

        auto loaderRes = rs::VarBitTypeLoader::fromIndex(cacheInfo, idx, 10, alloc);
        if (!loaderRes.isOk()) {
            return fail("VarBitTypeLoader::fromIndex failed");
        }
        rs::VarBitTypeLoader loader = rs::move(loaderRes.value());

        const rs::VarBitType* t = nullptr;
        const rs::Status s = loader.get(0, &t);
        if (!rs::ok(s) || !t) {
            return fail("VarBitTypeLoader.fromIndex.get(0) expected Ok");
        }
        if (t->baseVar != 0x0123 || t->startBit != 4 || t->endBit != 9) {
            return fail("VarBitType(index) decoded fields mismatch");
        }
    }

    return 0;
}

static int test_sprite_decode_packed_sprite_archive(rs::Allocator& alloc) {
    // Sprite decode: packed sprite archive (Dat2 sprite format).
    //
    // Build 1-sprite file:
    // - pixels: [dim=0][4 bytes]
    // - palette: 1 medium (paletteSize=2 => palette[1]=0x112233)
    // - meta: width=2,height=2,paletteSizeMinus1=1,xOff=0,yOff=0,subW=2,subH=2
    // - footer: spriteCount=1
    std::vector<rs::u8> bytes;
    bytes.reserve(1 + 4 + 3 + 13 + 2);

    bytes.push_back(0); // dim=0
    bytes.push_back(1);
    bytes.push_back(1);
    bytes.push_back(0);
    bytes.push_back(1);

    // palette[1] = 0x11 0x22 0x33
    bytes.push_back(0x11);
    bytes.push_back(0x22);
    bytes.push_back(0x33);

    appendU16BE(bytes, 2); // width
    appendU16BE(bytes, 2); // height
    bytes.push_back(1);    // paletteSizeMinus1 (=>2)

    appendU16BE(bytes, 0); // xOffset[0]
    appendU16BE(bytes, 0); // yOffset[0]
    appendU16BE(bytes, 2); // subWidth[0]
    appendU16BE(bytes, 2); // subHeight[0]

    appendU16BE(bytes, 1); // spriteCount

    auto res = rs::SpriteLoader::decodeSpriteArchive(rs::Span<const rs::u8>(bytes.data(), bytes.size()), alloc);
    if (!res.isOk()) {
        return fail("SpriteLoader::decodeSpriteArchive expected Ok");
    }
    rs::SpriteArchive arch = rs::move(res.value());
    if (arch.width != 2 || arch.height != 2 || arch.sprites.size() != 1) {
        return fail("SpriteArchive: unexpected dimensions/count");
    }
    const rs::IndexedSprite& sp = arch.sprites[0];
    if (sp.subWidth != 2 || sp.subHeight != 2 || sp.pixels.size() != 4) {
        return fail("IndexedSprite: unexpected sub dims/pixels");
    }
    if (sp.palette.size() != 2 || sp.palette[1] != 0x112233) {
        return fail("IndexedSprite: palette mismatch");
    }
    if (!(sp.pixels[0] == 1 && sp.pixels[1] == 1 && sp.pixels[2] == 0 && sp.pixels[3] == 1)) {
        return fail("IndexedSprite: pixels mismatch");
    }

    // Also cover readPixelsDimension=1 (x-major / column-major encoding).
    // Mirrors scripts/cache/texture-golden.ts (buildPackedSpriteSingle2x2ColumnMajor).
    {
        std::vector<rs::u8> bytes2;
        bytes2.reserve(1 + 4 + 6 + 13 + 2);

        bytes2.push_back(1); // dim=1
        bytes2.push_back(1); // (0,0)
        bytes2.push_back(0); // (0,1)
        bytes2.push_back(2); // (1,0)
        bytes2.push_back(1); // (1,1)

        // palette[1] = 0x00FF00, palette[2] = 0x0000FF
        bytes2.push_back(0x00);
        bytes2.push_back(0xFF);
        bytes2.push_back(0x00);
        bytes2.push_back(0x00);
        bytes2.push_back(0x00);
        bytes2.push_back(0xFF);

        appendU16BE(bytes2, 2); // width
        appendU16BE(bytes2, 2); // height
        bytes2.push_back(2);    // paletteSizeMinus1 (=>3)

        appendU16BE(bytes2, 0); // xOffset[0]
        appendU16BE(bytes2, 0); // yOffset[0]
        appendU16BE(bytes2, 2); // subWidth[0]
        appendU16BE(bytes2, 2); // subHeight[0]

        appendU16BE(bytes2, 1); // spriteCount

        auto res2 = rs::SpriteLoader::decodeSpriteArchive(rs::Span<const rs::u8>(bytes2.data(), bytes2.size()), alloc);
        if (!res2.isOk()) {
            return fail("SpriteLoader::decodeSpriteArchive(dim=1) expected Ok");
        }
        rs::SpriteArchive arch2 = rs::move(res2.value());
        if (arch2.width != 2 || arch2.height != 2 || arch2.sprites.size() != 1) {
            return fail("SpriteArchive(dim=1): unexpected dimensions/count");
        }
        const rs::IndexedSprite& sp2 = arch2.sprites[0];
        if (sp2.subWidth != 2 || sp2.subHeight != 2 || sp2.pixels.size() != 4) {
            return fail("IndexedSprite(dim=1): unexpected sub dims/pixels");
        }
        if (sp2.palette.size() != 3 || sp2.palette[1] != 0x00FF00 || sp2.palette[2] != 0x0000FF) {
            return fail("IndexedSprite(dim=1): palette mismatch");
        }
        if (!(sp2.pixels[0] == 1 && sp2.pixels[1] == 2 && sp2.pixels[2] == 0 && sp2.pixels[3] == 1)) {
            return fail("IndexedSprite(dim=1): pixels mismatch");
        }
    }
    return 0;
}

static int test_indexed_sprite_dat_and_dat_texture_loader(rs::Allocator& alloc) {
    // Legacy indexed-sprite DAT decode + DatTextureLoader pixel scaling.

    // index.dat bytes (indexOffset=0):
    // [width=64][height=64][paletteSize=3][palette[1]=0x112233][palette[2]=0x445566]
    // [xOff=0][yOff=0][subW=64][subH=64][type=0]
    std::vector<rs::u8> indexBytes;
    indexBytes.reserve(2 + 2 + 1 + 6 + 7);
    appendU16BE(indexBytes, 64);
    appendU16BE(indexBytes, 64);
    indexBytes.push_back(3); // paletteSize
    appendU24BE(indexBytes, 0x112233);
    appendU24BE(indexBytes, 0x445566);
    indexBytes.push_back(0); // xOff
    indexBytes.push_back(0); // yOff
    appendU16BE(indexBytes, 64);
    appendU16BE(indexBytes, 64);
    indexBytes.push_back(0); // type=0 (linear pixels)

    // 0.dat bytes:
    // [indexOffset u16 = 0] + 64*64 palette indices (rows alternate 1/2).
    std::vector<rs::u8> datBytes;
    datBytes.reserve(2 + 64 * 64);
    appendU16BE(datBytes, 0);
    datBytes.resize(2 + 64 * 64);
    for (int y = 0; y < 64; y++) {
        for (int x = 0; x < 64; x++) {
            const std::size_t i = 2 + static_cast<std::size_t>(x) + static_cast<std::size_t>(y) * 64u;
            datBytes[i] = static_cast<rs::u8>((y & 1) ? 2 : 1);
        }
    }

    {
        auto spriteRes = rs::SpriteLoader::decodeIndexedSpriteDat(
            rs::Span<const rs::u8>(datBytes.data(), datBytes.size()),
            rs::Span<const rs::u8>(indexBytes.data(), indexBytes.size()),
            0,
            alloc);
        if (!spriteRes.isOk()) {
            return fail("SpriteLoader::decodeIndexedSpriteDat expected Ok");
        }
        rs::IndexedSprite sp = rs::move(spriteRes.value());
        if (sp.subWidth != 64 || sp.subHeight != 64 || sp.width != 64 || sp.height != 64) {
            return fail("IndexedSpriteDat: unexpected dimensions");
        }
        if (sp.palette.size() != 3 || sp.palette[1] != 0x112233 || sp.palette[2] != 0x445566) {
            return fail("IndexedSpriteDat: palette mismatch");
        }
        if (sp.pixels.size() != 64u * 64u) {
            return fail("IndexedSpriteDat: pixels size mismatch");
        }
        if (sp.pixels[64] != 2) {
            return fail("IndexedSpriteDat: expected row-major pixel[64] to be 2 (row 1)");
        }
    }

    // Build an Archive with two named files: index.dat and 0.dat.
    rs::Vec<rs::ArchiveFile> files(alloc);
    {
        rs::Vec<rs::u8> idxData(alloc);
        auto rr = idxData.resize(indexBytes.size());
        if (!rr.isOk()) {
            return fail("DatTextureLoader test: OOM (index.dat)");
        }
        for (std::size_t i = 0; i < indexBytes.size(); i++) {
            idxData[i] = indexBytes[i];
        }

        rs::Vec<rs::u8> datData(alloc);
        rr = datData.resize(datBytes.size());
        if (!rr.isOk()) {
            return fail("DatTextureLoader test: OOM (0.dat)");
        }
        for (std::size_t i = 0; i < datBytes.size(); i++) {
            datData[i] = datBytes[i];
        }

        auto pr = files.emplaceBack(0, 0, rs::move(idxData), rs::hashOld("index.dat"));
        if (!pr.isOk()) {
            return fail("DatTextureLoader test: files.emplaceBack(index.dat) failed");
        }
        pr = files.emplaceBack(1, 0, rs::move(datData), rs::hashOld("0.dat"));
        if (!pr.isOk()) {
            return fail("DatTextureLoader test: files.emplaceBack(0.dat) failed");
        }
    }
    rs::Archive archive(0, 1, rs::move(files), alloc);

    auto loaderRes = rs::DatTextureLoader::create(rs::move(archive), rs::Span<const rs::i32>(nullptr, 0), alloc);
    if (!loaderRes.isOk()) {
        return fail("DatTextureLoader::create expected Ok");
    }
    rs::DatTextureLoader loader = rs::move(loaderRes.value());

    if (!loader.isSmall(0)) {
        return fail("DatTextureLoader: expected isSmall(0) == true");
    }
    if (loader.isTransparent(0)) {
        return fail("DatTextureLoader: expected isTransparent(0) == false");
    }

    {
        // averageHsl computed from average palette RGB (including palette[0]=0).
        const rs::i32 expectedAvgRgb = (28 << 16) + (39 << 8) + 51;
        const rs::i32 expectedHsl = rs::rgbToHsl(expectedAvgRgb);
        if (loader.getAverageHsl(0) != expectedHsl) {
            return fail("DatTextureLoader: averageHsl mismatch");
        }
    }

    {
        auto pixRes = loader.tryGetPixelsRgb(0, 128, false, 1.0f, alloc);
        if (!pixRes.isOk()) {
            return fail("DatTextureLoader::tryGetPixelsRgb expected Ok");
        }
        const rs::Vec<rs::i32>& pix = pixRes.value();
        if (pix.size() != 128u * 128u) {
            return fail("DatTextureLoader: pixels size mismatch for size=128");
        }

        // TS-matching scaling loop (x outer, y inner) + transposed src indexing:
        // (x=2,y=0) => outIdx=256; srcIdx=64 => row 1 => palette index 2.
        const rs::i32 expected = rs::brightenRgb(0x445566, 1.0f);
        if (pix[256] != expected) {
            return fail("DatTextureLoader: scaled pixel mismatch at outIdx=256");
        }
    }

    return 0;
}

static int test_old_config_loaders_synthetic(rs::Allocator& alloc) {
    // Synthetic old config archive with named files:
    // flo.dat, seq.dat, varbit.dat (DatTypeLoader)
    // loc/npc/obj .dat + .idx (IndexedDatTypeLoader)

    rs::CacheInfo cacheInfo{
        .name = "test",
        .game = rs::GameType::Runescape,
        .environment = "test",
        .revision = 300,
        .timestamp = "1970-01-01",
        .size = 0,
    };

    auto makeVecBytes = [&](const std::vector<rs::u8>& src) -> rs::Result<rs::Vec<rs::u8>> {
        rs::Vec<rs::u8> v(alloc);
        auto rr = v.resize(src.size());
        if (!rr.isOk()) {
            return rs::Result<rs::Vec<rs::u8>>::err(rr.status());
        }
        for (std::size_t i = 0; i < src.size(); i++) {
            v[i] = src[i];
        }
        return rs::Result<rs::Vec<rs::u8>>::ok(std::move(v));
    };

    auto makeDatTypeFile = [&](const char* /*name*/) -> std::vector<rs::u8> {
        // [u16 count=1][opcode=0]
        return std::vector<rs::u8>{0x00, 0x01, 0x00};
    };
    auto makeIndexedDat = [&](void) -> std::vector<rs::u8> {
        // [u16 count=1][entry0 bytes: opcode=0]
        return std::vector<rs::u8>{0x00, 0x01, 0x00};
    };
    auto makeIndexedIdx = [&](void) -> std::vector<rs::u8> {
        // [u16 count=1][u16 len0=1]
        return std::vector<rs::u8>{0x00, 0x01, 0x00, 0x01};
    };

    rs::Vec<rs::ArchiveFile> files(alloc);
    {
        // Order doesn't matter; ids just need to be non-negative.
        const struct NamedBytes {
            const char* name;
            std::vector<rs::u8> bytes;
        } entries[] = {
            {"flo.dat", makeDatTypeFile("flo.dat")},
            {"seq.dat", makeDatTypeFile("seq.dat")},
            {"varbit.dat", makeDatTypeFile("varbit.dat")},
            {"loc.dat", makeIndexedDat()},
            {"loc.idx", makeIndexedIdx()},
            {"npc.dat", makeIndexedDat()},
            {"npc.idx", makeIndexedIdx()},
            {"obj.dat", makeIndexedDat()},
            {"obj.idx", makeIndexedIdx()},
        };

        for (std::size_t i = 0; i < sizeof(entries) / sizeof(entries[0]); i++) {
            auto vecRes = makeVecBytes(entries[i].bytes);
            if (!vecRes.isOk()) {
                return fail("old config synthetic: OOM building file bytes");
            }
            const rs::i32 nameHash = rs::hashOld(entries[i].name);
            auto pr = files.emplaceBack(static_cast<rs::i32>(i), 0, std::move(vecRes.value()), nameHash);
            if (!pr.isOk()) {
                return fail("old config synthetic: files.emplaceBack failed");
            }
        }
    }

    rs::Archive configArchive(0, static_cast<rs::i32>(files.size() - 1), std::move(files), alloc);
    auto res = rs::OldConfigLoaders::tryCreate(cacheInfo, rs::CacheType::Dat, std::move(configArchive), alloc);
    if (!res.isOk()) {
        return fail("OldConfigLoaders::tryCreate expected Ok");
    }
    rs::OldConfigLoaders loaders = std::move(res.value());

    {
        const rs::OverlayFloorType* v = nullptr;
        const rs::Status s = loaders.floors.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: floors.get(0) expected Ok");
        }
    }
    {
        const rs::SeqType* v = nullptr;
        const rs::Status s = loaders.seqs.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: seqs.get(0) expected Ok");
        }
    }
    {
        const rs::VarBitType* v = nullptr;
        const rs::Status s = loaders.varbits.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: varbits.get(0) expected Ok");
        }
    }
    {
        const rs::LocType* v = nullptr;
        const rs::Status s = loaders.locs.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: locs.get(0) expected Ok");
        }
    }
    {
        const rs::NpcType* v = nullptr;
        const rs::Status s = loaders.npcs.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: npcs.get(0) expected Ok");
        }
    }
    {
        const rs::ObjType* v = nullptr;
        const rs::Status s = loaders.objs.get(0, &v);
        if (!rs::ok(s) || !v) {
            return fail("OldConfigLoaders: objs.get(0) expected Ok");
        }
    }

    return 0;
}

static int test_sprite_texture_loader_pixels(rs::Allocator& alloc, rs::NativeCompressionHandler& compression) {
    // SpriteTextureLoader: definition + sprite -> ARGB pixels.
    //
    // - One texture definition (id=0) referencing spriteId=0.
    // - One sprite archive (spriteId=0) containing 1 sprite (2x2), palette[1]=0x112233.
    // - Expect mapped pixels with alpha=0 for palette index 0.
    FakeStore store;

    const rs::i32 spritesIndexId = 8;
    store.dat2MetaByIndexId[spritesIndexId] = makeContainerNone(makeRefTableProtocol5SingleArchiveSingleFile(0, 0));

    // Sprite payload (same as previous test, but without the "meta spriteCount" wrapper outside).
    std::vector<rs::u8> spritePayload;
    spritePayload.reserve(1 + 4 + 3 + 13 + 2);

    spritePayload.push_back(0); // dim=0
    spritePayload.push_back(1);
    spritePayload.push_back(1);
    spritePayload.push_back(0);
    spritePayload.push_back(1);
    spritePayload.push_back(0x11);
    spritePayload.push_back(0x22);
    spritePayload.push_back(0x33);
    appendU16BE(spritePayload, 2);
    appendU16BE(spritePayload, 2);
    spritePayload.push_back(1);
    appendU16BE(spritePayload, 0);
    appendU16BE(spritePayload, 0);
    appendU16BE(spritePayload, 2);
    appendU16BE(spritePayload, 2);
    appendU16BE(spritePayload, 1);

    store.archivesByIndexAndArchiveId[std::make_pair(spritesIndexId, 0)] = makeContainerNone(spritePayload);

    auto idxRes = rs::CacheIndex::fromStore(rs::CacheType::Dat2, spritesIndexId, store, compression, alloc);
    if (!idxRes.isOk()) {
        return fail("SpriteTextureLoader: CacheIndex::fromStore(sprites) expected Ok");
    }
    rs::CacheIndex spritesIndex = rs::move(idxRes.value());

    // Texture definition archive: one file (id=0).
    rs::Vec<rs::u8> defBytes(alloc);
    auto rr = defBytes.resize(2 + 1 + 1 + 2 + 4 + 1 + 1);
    if (!rr.isOk()) {
        return fail("SpriteTextureLoader: OOM building definition");
    }
    std::size_t o = 0;
    defBytes[o++] = 0; // avgHsl u16
    defBytes[o++] = 0;
    defBytes[o++] = 1; // opaque
    defBytes[o++] = 1; // spriteCount
    defBytes[o++] = 0; // spriteId u16
    defBytes[o++] = 0;
    defBytes[o++] = 0; // transform i32
    defBytes[o++] = 0;
    defBytes[o++] = 0;
    defBytes[o++] = 0;
    defBytes[o++] = 0; // animDir
    defBytes[o++] = 0; // animSpeed

    rs::Vec<rs::ArchiveFile> files(alloc);
    auto pr = files.emplaceBack(0, 0, rs::move(defBytes));
    if (!pr.isOk()) {
        return fail("SpriteTextureLoader: OOM emplacing ArchiveFile");
    }
    rs::Archive defArchive(0, 0, rs::move(files), alloc);

    auto loaderRes = rs::SpriteTextureLoader::create(defArchive, spritesIndex, alloc);
    if (!loaderRes.isOk()) {
        return fail("SpriteTextureLoader::create expected Ok");
    }
    rs::SpriteTextureLoader loader = rs::move(loaderRes.value());

    auto pixRes = loader.tryGetPixelsArgb(0, 2, false, 1.0f, alloc);
    if (!pixRes.isOk()) {
        return fail("SpriteTextureLoader.tryGetPixelsArgb expected Ok");
    }
    rs::Vec<rs::i32> pix = rs::move(pixRes.value());
    if (pix.size() != 4) {
        return fail("SpriteTextureLoader pixels: expected 4");
    }
    const rs::i32 c = static_cast<rs::i32>(0xFF112233u);
    if (!(pix[0] == c && pix[1] == c && pix[2] == 0 && pix[3] == c)) {
        return fail("SpriteTextureLoader pixels: mismatch");
    }

    // SpriteTextureLoader: dim=1 (column-major) packed sprite case.
    // Mirrors scripts/cache/texture-golden.ts (testSpriteTextureColumnMajorGolden).
    {
        FakeStore store2;
        const rs::i32 spritesIndexId2 = 8;
        store2.dat2MetaByIndexId[spritesIndexId2] = makeContainerNone(makeRefTableProtocol5SingleArchiveSingleFile(0, 0));

        std::vector<rs::u8> spritePayload2;
        spritePayload2.reserve(1 + 4 + 6 + 13 + 2);
        spritePayload2.push_back(1); // dim=1

        // dim=1 encoding reads pixels in x-major order; for desired row-major [1,2,0,1]:
        // bytes: (0,0)=1 (0,1)=0 (1,0)=2 (1,1)=1
        spritePayload2.push_back(1);
        spritePayload2.push_back(0);
        spritePayload2.push_back(2);
        spritePayload2.push_back(1);

        // palette[1]=0x00ff00, palette[2]=0x0000ff
        spritePayload2.push_back(0x00);
        spritePayload2.push_back(0xFF);
        spritePayload2.push_back(0x00);
        spritePayload2.push_back(0x00);
        spritePayload2.push_back(0x00);
        spritePayload2.push_back(0xFF);

        appendU16BE(spritePayload2, 2); // width
        appendU16BE(spritePayload2, 2); // height
        spritePayload2.push_back(2);    // paletteSizeMinus1 (=>3)
        appendU16BE(spritePayload2, 0); // xOffset[0]
        appendU16BE(spritePayload2, 0); // yOffset[0]
        appendU16BE(spritePayload2, 2); // subWidth[0]
        appendU16BE(spritePayload2, 2); // subHeight[0]
        appendU16BE(spritePayload2, 1); // spriteCount

        store2.archivesByIndexAndArchiveId[std::make_pair(spritesIndexId2, 0)] = makeContainerNone(spritePayload2);

        auto idxRes2 = rs::CacheIndex::fromStore(rs::CacheType::Dat2, spritesIndexId2, store2, compression, alloc);
        if (!idxRes2.isOk()) {
            return fail("SpriteTextureLoader(column-major): CacheIndex::fromStore(sprites) expected Ok");
        }
        rs::CacheIndex spritesIndex2 = rs::move(idxRes2.value());

        // Texture definition archive: one file (id=0), avgHsl=0x1234 (matches TS golden).
        rs::Vec<rs::u8> defBytes2(alloc);
        auto rr2 = defBytes2.resize(2 + 1 + 1 + 2 + 4 + 1 + 1);
        if (!rr2.isOk()) {
            return fail("SpriteTextureLoader(column-major): OOM building definition");
        }
        std::size_t o2 = 0;
        defBytes2[o2++] = 0x12;
        defBytes2[o2++] = 0x34;
        defBytes2[o2++] = 1; // opaque
        defBytes2[o2++] = 1; // spriteCount
        defBytes2[o2++] = 0; // spriteId u16
        defBytes2[o2++] = 0;
        defBytes2[o2++] = 0; // transform i32
        defBytes2[o2++] = 0;
        defBytes2[o2++] = 0;
        defBytes2[o2++] = 0;
        defBytes2[o2++] = 0; // animDir
        defBytes2[o2++] = 0; // animSpeed

        rs::Vec<rs::ArchiveFile> files2(alloc);
        auto pr2 = files2.emplaceBack(0, 0, rs::move(defBytes2));
        if (!pr2.isOk()) {
            return fail("SpriteTextureLoader(column-major): OOM emplacing ArchiveFile");
        }
        rs::Archive defArchive2(0, 0, rs::move(files2), alloc);

        auto loaderRes2 = rs::SpriteTextureLoader::create(defArchive2, spritesIndex2, alloc);
        if (!loaderRes2.isOk()) {
            return fail("SpriteTextureLoader(column-major)::create expected Ok");
        }
        rs::SpriteTextureLoader loader2 = rs::move(loaderRes2.value());

        auto pixRes2 = loader2.tryGetPixelsArgb(0, 2, false, 1.0f, alloc);
        if (!pixRes2.isOk()) {
            return fail("SpriteTextureLoader(column-major).tryGetPixelsArgb expected Ok");
        }
        rs::Vec<rs::i32> pix2 = rs::move(pixRes2.value());
        if (pix2.size() != 4) {
            return fail("SpriteTextureLoader(column-major) pixels: expected 4");
        }
        const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pix2.data(), pix2.size()));
        if (hash != -1075740621) {
            return fail("SpriteTextureLoader(column-major) hash mismatch");
        }
    }
    return 0;
}

} // namespace

namespace {

static int test_config_floor_types(rs::Allocator& alloc) {
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

    return 0;
}

static int test_config_misc_goldens(rs::Allocator& alloc) {
    {
        // Config decode: VarPlayerType.
        const rs::CacheInfo cacheInfo{
            .name = "test",
            .game = rs::GameType::Runescape,
            .environment = "test",
            .revision = 500,
            .timestamp = "1970-01-01",
            .size = 0,
        };

        // [5][type=0x1234][0]
        rs::Vec<rs::u8> fileBytes(alloc);
        auto rr = fileBytes.resize(1 + 2 + 1);
        if (!rr.isOk()) {
            return fail("VarPlayerType: OOM");
        }
        fileBytes[0] = 5;
        fileBytes[1] = 0x12;
        fileBytes[2] = 0x34;
        fileBytes[3] = 0;

        auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
        if (!archRes.isOk()) {
            return fail("VarPlayerType: Archive::create failed");
        }
        rs::Archive archive = rs::move(archRes.value());

        auto loaderRes = rs::VarPlayerTypeLoader::fromArchive(cacheInfo, archive, alloc);
        if (!loaderRes.isOk()) {
            return fail("VarPlayerTypeLoader::fromArchive failed");
        }
        rs::VarPlayerTypeLoader loader = rs::move(loaderRes.value());

        const rs::VarPlayerType* t = nullptr;
        const rs::Status s = loader.get(0, &t);
        if (!rs::ok(s) || !t || t->type != 0x1234) {
            return fail("VarPlayerType decoded fields mismatch");
        }
    }

    {
        // Config decode: VarClientIntType / VarClientStrType persist flag.
        const rs::CacheInfo cacheInfo{
            .name = "test",
            .game = rs::GameType::Runescape,
            .environment = "test",
            .revision = 500,
            .timestamp = "1970-01-01",
            .size = 0,
        };

        // [2][0]
        {
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(2);
            if (!rr.isOk()) {
                return fail("VarClientIntType: OOM");
            }
            fileBytes[0] = 2;
            fileBytes[1] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("VarClientIntType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::VarClientIntTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("VarClientIntTypeLoader::fromArchive failed");
            }
            rs::VarClientIntTypeLoader loader = rs::move(loaderRes.value());

            const rs::VarClientIntType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || !t->persist) {
                return fail("VarClientIntType decoded fields mismatch");
            }
        }

        {
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(2);
            if (!rr.isOk()) {
                return fail("VarClientStrType: OOM");
            }
            fileBytes[0] = 2;
            fileBytes[1] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("VarClientStrType: Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::VarClientStrTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("VarClientStrTypeLoader::fromArchive failed");
            }
            rs::VarClientStrTypeLoader loader = rs::move(loaderRes.value());

            const rs::VarClientStrType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t || !t->persist) {
                return fail("VarClientStrType decoded fields mismatch");
            }
        }
    }

    {
        // Config decode: GraphicsDefaults opcode 2 (bigSmart u16 form).
        const rs::CacheInfo cacheInfo{
            .name = "test",
            .game = rs::GameType::Runescape,
            .environment = "test",
            .revision = 500,
            .timestamp = "1970-01-01",
            .size = 0,
        };

        std::vector<rs::u8> bytes;
        bytes.push_back(2);
        appendU16BE(bytes, 1);
        appendU16BE(bytes, 2);
        appendU16BE(bytes, 3);
        appendU16BE(bytes, 4);
        appendU16BE(bytes, 5);
        appendU16BE(bytes, 6);
        appendU16BE(bytes, 7);
        appendU16BE(bytes, 8);
        appendU16BE(bytes, 9);
        appendU16BE(bytes, 10);
        appendU16BE(bytes, 11);
        bytes.push_back(0);

        rs::GraphicsDefaults gd(-1, cacheInfo);
        rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
        rs::TypeDecodeError err{};
        const rs::Status s = rs::decodeType(gd, reader, &err, nullptr);
        if (!rs::ok(s) || gd.compass != 1 || gd.mapEdge != 2 || gd.modIcons != 11) {
            return fail("GraphicsDefaults decoded fields mismatch");
        }
    }

    return 0;
}

} // namespace

int main() {
    try {
        rs::Allocator& alloc = rs::defaultAllocator();
        rs::NativeCompressionHandler compression;

        if (int r = testTerrainHeightsGoldenOldFormat(alloc)) return r;

        if (int r = test_gzip(alloc, compression)) return r;
        if (int r = test_cache_index_and_system(alloc, compression)) return r;

        if (int r = test_varbit_type_loaders(alloc, compression)) return r;
        if (int r = test_sprite_decode_packed_sprite_archive(alloc)) return r;
        if (int r = test_indexed_sprite_dat_and_dat_texture_loader(alloc)) return r;
        if (int r = test_old_config_loaders_synthetic(alloc)) return r;
	        if (int r = test_sprite_texture_loader_pixels(alloc, compression)) return r;

	        if (int r = test_config_floor_types(alloc)) return r;
	        if (int r = test_config_misc_goldens(alloc)) return r;

	        if (int r = [&]() -> int {
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
            // Config decode: EnumType with string values (variant: larger key + different default string).
            // Mirrors scripts/cache/config-golden.ts (EnumType block).
            const rs::CacheInfo cacheInfo{
                .name = "test",
                .game = rs::GameType::Runescape,
                .environment = "test",
                .revision = 500,
                .timestamp = "1970-01-01",
                .size = 0,
            };

            // Bytes:
            // [1]['i'][2]['s'][3]["none\0"][5][count=2][key=0x01020304][val="a\0"][key=42][val="b\0"][0]
            rs::Vec<rs::u8> fileBytes(alloc);
            auto rr = fileBytes.resize(1 + 1 + 1 + 1 + 1 + 5 + 1 + 2 + (4 + 2) + (4 + 2) + 1);
            if (!rr.isOk()) {
                return fail("EnumType(variant): OOM");
            }
            std::size_t off = 0;
            fileBytes[off++] = 1;
            fileBytes[off++] = static_cast<rs::u8>('i');
            fileBytes[off++] = 2;
            fileBytes[off++] = static_cast<rs::u8>('s');
            fileBytes[off++] = 3;
            fileBytes[off++] = static_cast<rs::u8>('n');
            fileBytes[off++] = static_cast<rs::u8>('o');
            fileBytes[off++] = static_cast<rs::u8>('n');
            fileBytes[off++] = static_cast<rs::u8>('e');
            fileBytes[off++] = 0;
            fileBytes[off++] = 5;
            fileBytes[off++] = 0;
            fileBytes[off++] = 2; // u16 count
            // key=0x01020304
            fileBytes[off++] = 0x01;
            fileBytes[off++] = 0x02;
            fileBytes[off++] = 0x03;
            fileBytes[off++] = 0x04;
            // val="a"
            fileBytes[off++] = static_cast<rs::u8>('a');
            fileBytes[off++] = 0;
            // key=42
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;
            fileBytes[off++] = 42;
            // val="b"
            fileBytes[off++] = static_cast<rs::u8>('b');
            fileBytes[off++] = 0;
            fileBytes[off++] = 0;

            auto archRes = rs::Archive::create(0, rs::move(fileBytes), alloc);
            if (!archRes.isOk()) {
                return fail("EnumType(variant): Archive::create failed");
            }
            rs::Archive archive = rs::move(archRes.value());

            auto loaderRes = rs::EnumTypeLoader::fromArchive(cacheInfo, archive, alloc);
            if (!loaderRes.isOk()) {
                return fail("EnumTypeLoader::fromArchive(variant) failed");
            }
            rs::EnumTypeLoader loader = rs::move(loaderRes.value());

            const rs::EnumType* t = nullptr;
            const rs::Status s = loader.get(0, &t);
            if (!rs::ok(s) || !t) {
                return fail("EnumTypeLoader.get(0) variant expected Ok");
            }
            if (t->inputType != 'i' || t->outputType != 's') {
                return fail("EnumType(variant) types mismatch");
            }
            if (t->outputCount != 2 || t->keys.size() != 2 || t->stringValues.size() != 2) {
                return fail("EnumType(variant) sizes mismatch");
            }
            if (t->keys[0] != 0x01020304 || t->keys[1] != 42) {
                return fail("EnumType(variant) keys mismatch");
            }
            if (t->defaultString.len != 4 || !t->defaultString.data) {
                return fail("EnumType(variant) defaultString missing");
            }
            if (!(t->defaultString.data[0] == 'n' && t->defaultString.data[1] == 'o' && t->defaultString.data[2] == 'n' &&
                  t->defaultString.data[3] == 'e')) {
                return fail("EnumType(variant) defaultString mismatch");
            }
            if (t->stringValues[0].len != 1 || t->stringValues[1].len != 1) {
                return fail("EnumType(variant) stringValues length mismatch");
            }
            if (!(t->stringValues[0].data && t->stringValues[0].data[0] == 'a')) {
                return fail("EnumType(variant) stringValues[0] mismatch");
            }
            if (!(t->stringValues[1].data && t->stringValues[1].data[0] == 'b')) {
                return fail("EnumType(variant) stringValues[1] mismatch");
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

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
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

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
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

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
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

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: synthetic constant-colour case (mirrors scripts/cache/texture-golden.ts).
	            const std::vector<rs::u8> bytes = {
	                0x01, // op count
                0x00, // op id
                0x01, // type id: ConstantColour
                0xFF, // cache slot count: all lines
                0x01, // property count
                0x00, // property id
                0x11, 0x22, 0x33, // rgb medium
                0x00, // colour op index
                0x00, // mono op index
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("ProceduralTexture::decode: expected Ok");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 4, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("ProceduralTexture::getPixelsArgb: expected Ok");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 16) {
                return fail("ProceduralTexture::getPixelsArgb: expected 16 pixels");
            }
            for (std::size_t i = 0; i < pixels.size(); i++) {
                if (static_cast<rs::u32>(pixels[i]) != 0xFF112233u) {
                    return fail("ProceduralTexture::getPixelsArgb: pixel mismatch");
                }
            }

            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            if (hash != 1690597541) {
                return fail("ProceduralTexture: hash mismatch");
            }
        }

        {
            // ProceduralTexture: PerlinNoise (mirrors scripts/cache/texture-golden.ts).
            const std::vector<rs::u8> bytes = {
                0x01, // op count
                0x00, // op id
                0x22, // type id: PerlinNoise (34)
                0xFF, // cache slot count
                0x03, // property count
                0x00, // field 0: unsignedOutput
                0x01, // true
                0x01, // field 1: octaveCount
                0x01, // 1
                0x04, // field 4: seed
                0x00, // seed=0
                0x00, // colour op index
                0x00, // mono op index
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("PerlinNoise: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("PerlinNoise: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            if (hash != 1083685253) {
                return fail("PerlinNoise: hash mismatch");
            }
        }

        {
            // ProceduralTexture: PerlinNoise explicit amplitudes (mirrors scripts/cache/texture-golden.ts).
            const std::vector<rs::u8> bytes = {
                0x01, // op count
                0x00, // op id
                0x22, // type id: PerlinNoise (34)
                0xFF, // cache slot count
                0x06, // property count
                0x00, // field 0: unsignedOutput
                0x01, // true
                0x01, // field 1: octaveCount
                0x03, // 3
                0x02, // field 2: persistenceQ12 + amplitudes
                0xFF, 0xFF, // -1
                0x10, 0x00, // 4096
                0x08, 0x00, // 2048
                0x04, 0x00, // 1024
                0x05, // field 5: repeatX
                0x05,
                0x06, // field 6: repeatY
                0x07,
                0x04, // field 4: seed
                0x00, // seed=0
                0x00, // colour op index
                0x00, // mono op index
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("PerlinNoise(explicit): decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("PerlinNoise(explicit): getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            if (hash != 994396825) {
                return fail("PerlinNoise(explicit): hash mismatch");
            }
        }

        {
            // ProceduralTexture: PerlinNoise signed multi-octave (mirrors scripts/cache/texture-golden.ts).
            const std::vector<rs::u8> bytes = {
                0x01, // op count
                0x00, // op id
                0x22, // type id: PerlinNoise (34)
                0xFF, // cache slot count
                0x06, // property count
                0x00, // field 0: unsignedOutput
                0x00, // false
                0x01, // field 1: octaveCount
                0x04, // 4
                0x02, // field 2: persistenceQ12
                0x0B, 0x33, // 2867
                0x04, // field 4: seed
                0x02, // seed=2
                0x05, // field 5: repeatX
                0x03,
                0x06, // field 6: repeatY
                0x06,
                0x00, // colour op index
                0x00, // mono op index
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("PerlinNoise(signed): decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("PerlinNoise(signed): getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
	            if (hash != -1896865793) {
	                return fail("PerlinNoise(signed): hash mismatch");
	            }
	        }

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: Emboss on HorizontalGradient (mirrors scripts/cache/texture-golden.ts).
	            const std::vector<rs::u8> bytes = {
                0x02, // op count
                0x00, // op id
                0x02, // type id: HorizontalGradient
                0xFF, // cache slot count
                0x00, // property count
                0x01, // op id
                0x20, // type id: Emboss (32)
                0xFF, // cache slot count
                0x00, // property count
                0x00, // op1 input: op0
                0x01, // colour op index
                0x01, // mono op index
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Emboss: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 8, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Emboss: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            if (hash != 498467797) {
                return fail("Emboss: hash mismatch");
            }
        }

        {
            // ProceduralTexture: Emboss on HorizontalGradient (LRU cacheSlotCount=3) (mirrors scripts/cache/texture-golden.ts).
            const std::vector<rs::u8> bytes = {
                0x02, // op count
                // op0: HorizontalGradient
                0x00, // op id
                0x02, // type id
                0x03, // cache slot count
                0x00, // property count
                // op1: Emboss
                0x01, // op id
                0x20, // type id: Emboss (32)
                0x03, // cache slot count
                0x00, // property count
                // inputs for op1: op0
                0x00,
                // colour op index
                0x01,
                // mono op index
                0x01,
            };

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Emboss(LRU): decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Emboss(LRU): getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            if (hash != 1953712197) {
                return fail("Emboss(LRU): hash mismatch");
            }
        }

        {
            // ProceduralTexture: VoronoiNoise (mirrors scripts/cache/texture-golden.ts).
            const std::vector<rs::u8> bytes = {
                0x01, // op count
	                0x00, // op id
	                0x0F, // type id: VoronoiNoise (15)
	                0xFF, // cache slot count
	                0x00, // property count
	                0x00, // colour op index
	                0x00, // mono op index
	            };

	            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
	            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
	            if (!texRes.isOk()) {
	                return fail("VoronoiNoise: decode failed");
	            }
	            rs::ProceduralTexture tex = rs::move(texRes.value());

	            rs::TextureGenerator gen(alloc);
	            auto pixRes = tex.getPixelsArgb(gen, 16, 16, false, false, 1.0f, alloc);
	            if (!pixRes.isOk()) {
	                return fail("VoronoiNoise: getPixelsArgb failed");
	            }
	            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
	            if (hash != 1281243685) {
	                return fail("VoronoiNoise: hash mismatch");
	            }
	        }

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: TrigWarp (mirrors scripts/cache/texture-golden.ts).
	            const std::vector<rs::u8> bytes = {
	                0x04, // op count
	                // op0: ConstantColour (0x112233)
	                0x00,
	                0x01,
	                0xFF,
	                0x01,
	                0x00,
	                0x11, 0x22, 0x33,
	                // op1: HorizontalGradient
	                0x01,
	                0x02,
	                0xFF,
	                0x00,
	                // op2: ConstantMonochrome (255 => 4096)
	                0x02,
	                0x00,
	                0xFF,
	                0x01,
	                0x00,
	                0xFF,
	                // op3: TrigWarp (defaults)
	                0x03,
	                0x13, // type id: TrigWarp (19)
	                0xFF,
	                0x00, // property count
	                // inputs: base=op0, angle=op1, radius=op2
	                0x00,
	                0x01,
	                0x02,
	                // outputs
	                0x03,
	                0x03,
	            };

	            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
	            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
	            if (!texRes.isOk()) {
	                return fail("TrigWarp: decode failed");
	            }
	            rs::ProceduralTexture tex = rs::move(texRes.value());

	            rs::TextureGenerator gen(alloc);
	            auto pixRes = tex.getPixelsArgb(gen, 16, 16, false, false, 1.0f, alloc);
	            if (!pixRes.isOk()) {
	                return fail("TrigWarp: getPixelsArgb failed");
	            }
	            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
	            if (hash != -366360635) {
	                return fail("TrigWarp: hash mismatch");
	            }
	        }

	        {
	            // ProceduralTexture: Hsl (mirrors scripts/cache/texture-golden.ts).
	            const std::vector<rs::u8> bytes = {
	                0x02, // op count
	                // op0: ConstantColour (0x336699)
	                0x00,
	                0x01,
	                0xFF,
	                0x01,
	                0x00,
	                0x33, 0x66, 0x99,
	                // op1: Hsl
	                0x01,
	                0x11, // type id: Hsl (17)
	                0xFF,
	                0x03, // property count
	                0x00, // field 0: deltaHue i16
	                0x01, 0x00, // 256
	                0x01, // field 1: deltaSaturation byte
	                0x0A, // +10
	                0x02, // field 2: deltaLightness byte
	                0xF6, // -10
	                // inputs for op1: op0
	                0x00,
	                // outputs
	                0x01,
	                0x01,
	            };

	            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
	            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
	            if (!texRes.isOk()) {
	                return fail("Hsl: decode failed");
	            }
	            rs::ProceduralTexture tex = rs::move(texRes.value());

	            rs::TextureGenerator gen(alloc);
	            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
	            if (!pixRes.isOk()) {
	                return fail("Hsl: getPixelsArgb failed");
	            }
	            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
	            if (hash != -1873673019) {
	                return fail("Hsl: hash mismatch");
	            }
	        }

	        {
	            // ProceduralTexture: Tiling (mirrors scripts/cache/texture-golden.ts).
	            const std::vector<rs::u8> bytes = {
	                0x02, // op count
	                // op0: HorizontalGradient
	                0x00,
	                0x02,
	                0xFF,
	                0x00,
	                // op1: Tiling
	                0x01,
	                0x14, // type id: Tiling (20)
	                0xFF,
	                0x02, // property count
	                0x00,
	                0x02, // tileCountH=2
	                0x01,
	                0x02, // tileCountV=2
	                // inputs for op1: op0
	                0x00,
	                // outputs
	                0x01,
	                0x01,
	            };

	            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
	            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
	            if (!texRes.isOk()) {
	                return fail("Tiling: decode failed");
	            }
	            rs::ProceduralTexture tex = rs::move(texRes.value());

	            rs::TextureGenerator gen(alloc);
	            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
	            if (!pixRes.isOk()) {
	                return fail("Tiling: getPixelsArgb failed");
	            }
	            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
			            if (hash != -2062456891) {
			                return fail("Tiling: hash mismatch");
			            }
		        }

		            return 0;
		        }()) return r;

		        if (int r = [&]() -> int {
		        {
		            // ProceduralTexture: SquareWaveform (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x1B, // type id: SquareWaveform (27)
		                0xFF, // cache slot count
		                0x02, // property count
		                0x00, // field 0: periodCount
		                0x04,
		                0x02, // field 2: directionMode
		                0x01, // Horizontal
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("SquareWaveform: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("SquareWaveform: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -857058491) {
		                return fail("SquareWaveform: hash mismatch");
		            }
		        }

		        {
		            // ProceduralTexture: LineNoise (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x26, // type id: LineNoise (38)
		                0xFF, // cache slot count
		                0x03, // property count
		                0x00, // field 0: seed
		                0x00,
		                0x01, // field 1: lineCount
		                0x00,
		                0x14, // 20
		                0x02, // field 2: lineLength
		                0x04,
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("LineNoise: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 16, 16, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("LineNoise: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 1075852014) {
		                return fail("LineNoise: hash mismatch");
		            }
		        }

		        {
		            // ProceduralTexture: ShapeRasterizer (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x1D, // type id: ShapeRasterizer (29)
		                0xFF, // cache slot count
		                0x02, // property count
		                0x00, // field 0: shapes
		                0x03, // 3 shapes
		                // shape0: Line
		                0x00, // type
		                0x00, 0x00, // x0
		                0x00, 0x00, // y0
		                0x10, 0x00, // x1=4096
		                0x10, 0x00, // y1=4096
		                0xFF, 0x00, 0x00, // color
		                0x01, // outlineWidth (unused)
		                // shape1: Rectangle
		                0x02, // type
		                0x02, 0x00, // x0=512
		                0x02, 0x00, // y0=512
		                0x0E, 0x00, // x1=3584
		                0x08, 0x00, // y1=2048
		                0x00, 0xFF, 0x00, // fill
		                0x00, 0x00, 0xFF, // outline
		                0x02, // outlineWidth
		                // shape2: Ellipse
		                0x03, // type
		                0x08, 0x00, // x=2048
		                0x0C, 0x00, // y=3072
		                0x04, 0x00, // sizeX=1024
		                0x02, 0x00, // sizeY=512
		                0xFF, 0xFF, 0x00, // fill
		                0x00, 0xFF, 0xFF, // outline (ignored with outlineWidth=0)
		                0x00, // outlineWidth=0 (fill-only)
		                0x01, // field 1: isMonochrome
		                0x00, // colour output
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("ShapeRasterizer: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("ShapeRasterizer: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -68779725) {
		                return fail("ShapeRasterizer: hash mismatch");
		            }
		        }

		        {
		            // ProceduralTexture: Bricks (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x04, // type id: Bricks (4)
		                0xFF, // cache slot count
		                0x03, // property count
		                0x00, // field 0: columns
		                0x05, // 5
		                0x01, // field 1: rowCount
		                0x07, // 7
		                0x06, // field 6: mortarThicknessQ12
		                0x00, 0x78, // 120
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("Bricks: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("Bricks: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
			            if (hash != -1080788923) {
			                return fail("Bricks: hash mismatch");
			            }
		        }

		            return 0;
		        }()) return r;

		        if (int r = [&]() -> int {
		        {
		            // ProceduralTexture: RangeThreshold (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02, // op count
		                // op0: PseudoRandomNoise (13)
		                0x00,
		                0x0D,
		                0xFF,
		                0x00,
		                // op1: RangeThreshold (26)
		                0x01,
		                0x1A,
		                0xFF,
		                0x02, // property count
		                0x00, // min
		                0x05, 0xDC, // 1500
		                0x01, // max
		                0x0B, 0xB8, // 3000
		                // inputs for op1: op0
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("RangeThreshold: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("RangeThreshold: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -671145707) {
		                return fail("RangeThreshold: hash mismatch");
		            }
		        }

		        {
		            // ProceduralTexture: PseudoRandomNoise (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x0D, // type id: PseudoRandomNoise (13)
		                0xFF, // cache slot count
		                0x00, // property count
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("PseudoRandomNoise: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("PseudoRandomNoise: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -1014956354) {
		                return fail(std::string("PseudoRandomNoise: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: Kaleidoscope (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02, // op count
		                // op0: HorizontalGradient (2)
		                0x00,
		                0x02,
		                0xFF,
		                0x00,
		                // op1: Kaleidoscope (23)
		                0x01,
		                0x17,
		                0xFF,
		                0x01, // property count
		                0x00, // field 0: isMonochrome
		                0x00, // false
		                // inputs for op1: op0
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("Kaleidoscope: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("Kaleidoscope: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
			            if (hash != 903669829) {
			                return fail(std::string("Kaleidoscope: hash mismatch (got=") + std::to_string(hash) + ")");
			            }
		        }

		            return 0;
		        }()) return r;

		        if (int r = [&]() -> int {
		        {
		            // ProceduralTexture: IrregularBricks (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x1C, // type id: IrregularBricks (28)
		                0xFF, // cache slot count
		                0x01, // property count
		                0x00, // field 0: seed
		                0x01, // seed=1
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("IrregularBricks: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("IrregularBricks: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -1988142712) {
		                return fail(std::string("IrregularBricks: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: ColourStrip (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02, // op count
		                // op0: ConstantMonochrome (v=128)
		                0x00,
		                0x00,
		                0xFF,
		                0x01,
		                0x00,
		                0x80,
		                // op1: ColourStrip (11)
		                0x01,
		                0x0B,
		                0xFF,
		                0x03,
		                0x00,
		                0x0B, 0xB8, // 3000
		                0x01,
		                0x07, 0xD0, // 2000
		                0x02,
		                0x03, 0xE8, // 1000
		                // inputs for op1: op0
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("ColourStrip: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("ColourStrip: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -665541179) {
		                return fail(std::string("ColourStrip: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: DiagonalGradient (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01, // op count
		                0x00, // op id
		                0x0C, // type id: DiagonalGradient (12)
		                0xFF,
		                0x03, // property count
		                0x00,
		                0x01, // distanceMode=Radial
		                0x01,
		                0x02, // waveform=Triangle
		                0x03,
		                0x02, // frequency=2
		                0x00, // colour op index
		                0x00, // mono op index
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("DiagonalGradient: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("DiagonalGradient: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 1793811663) {
		                return fail(std::string("DiagonalGradient: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: Weave (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01,
		                0x00,
		                0x0E, // Weave (14)
		                0xFF,
		                0x01,
		                0x00,
		                0x02, 0xBC, // 700
		                0x00,
		                0x00,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("Weave: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("Weave: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 339314581) {
		                return fail(std::string("Weave: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: WavyCross (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01,
		                0x00,
		                0x25, // WavyCross (37)
		                0xFF,
		                0x00,
		                0x00,
		                0x00,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("WavyCross: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("WavyCross: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
			            if (hash != 1350480285) {
			                return fail(std::string("WavyCross: hash mismatch (got=") + std::to_string(hash) + ")");
			            }
		        }

		            return 0;
		        }()) return r;

		        if (int r = [&]() -> int {
		        {
		            // ProceduralTexture: GrayScale (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02,
		                // op0: ConstantColour
		                0x00,
		                0x01,
		                0xFF,
		                0x01,
		                0x00,
		                0x33, 0x66, 0x99,
		                // op1: GrayScale (24)
		                0x01,
		                0x18,
		                0xFF,
		                0x00,
		                // inputs
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("GrayScale: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("GrayScale: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 1718949061) {
		                return fail(std::string("GrayScale: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: Herringbone (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x01,
		                0x00,
		                0x10, // Herringbone (16)
		                0xFF,
		                0x03,
		                0x00,
		                0x02,
		                0x01,
		                0x03,
		                0x02,
		                0x01, 0x2C, // 300
		                0x00,
		                0x00,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("Herringbone: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("Herringbone: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -535527363) {
		                return fail(std::string("Herringbone: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: NormalMap (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02,
		                // op0: HorizontalGradient
		                0x00,
		                0x02,
		                0xFF,
		                0x00,
		                // op1: NormalMap (33)
		                0x01,
		                0x21,
		                0xFF,
		                0x02,
		                0x01,
		                0x10, 0x00, // 4096
		                0x02,
		                0x01, // unsignedOutput=1
		                // inputs
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("NormalMap: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("NormalMap: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 1800683461) {
		                return fail(std::string("NormalMap: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: Brightness (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02,
		                // op0: ConstantColour
		                0x00,
		                0x01,
		                0xFF,
		                0x01,
		                0x00,
		                0x22, 0x44, 0x66,
		                // op1: Brightness (25)
		                0x01,
		                0x19,
		                0xFF,
		                0x05,
		                0x00,
		                0x01, 0xF4, // maxValue=500
		                0x01,
		                0x11, 0x94, // blueFactor=4500
		                0x02,
		                0x10, 0x00, // greenFactor=4096
		                0x03,
		                0x0B, 0xB8, // redFactor=3000
		                0x04,
		                0x11, 0x22, 0x33, // rgb delta
		                // inputs
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("Brightness: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 8, 8, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("Brightness: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != 1896326853) {
		                return fail(std::string("Brightness: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // ProceduralTexture: MonochromeEdgeDetector (mirrors scripts/cache/texture-golden.ts).
		            const std::vector<rs::u8> bytes = {
		                0x02, // op count
		                // op0: PseudoRandomNoise (13)
		                0x00,
		                0x0D,
		                0xFF,
		                0x00,
		                // op1: MonochromeEdgeDetector (35)
		                0x01,
		                0x23,
		                0xFF,
		                0x01, // property count
		                0x00,
		                0x10, 0x00, // strength=4096
		                // inputs for op1: op0
		                0x00,
		                // outputs
		                0x01,
		                0x01,
		            };

		            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
		            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
		            if (!texRes.isOk()) {
		                return fail("MonochromeEdgeDetector: decode failed");
		            }
		            rs::ProceduralTexture tex = rs::move(texRes.value());

		            rs::TextureGenerator gen(alloc);
		            auto pixRes = tex.getPixelsArgb(gen, 32, 32, false, false, 1.0f, alloc);
		            if (!pixRes.isOk()) {
		                return fail("MonochromeEdgeDetector: getPixelsArgb failed");
		            }
		            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
		            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
		            if (hash != -921469807) {
		                return fail(std::string("MonochromeEdgeDetector: hash mismatch (got=") + std::to_string(hash) + ")");
		            }
		        }

		        {
		            // OldProceduralTextureDefinition: decode + pixels (procedural part is shared).
		            std::vector<rs::u8> bytes = {
		                0x01, // op count
                0x00, // op id
                0x01, // type id: ConstantColour
                0xFF, // cache slot count: all lines
                0x01, // property count
                0x00, // property id
                0x11, 0x22, 0x33, // rgb medium
                0x00, // colour op index
                0x00, // mono op index
                0x03, // flags: flag1+valid
                0x40, // size (64)
                0x12, 0x34, // averageHsl u16
                0xFF, // unused => 256
                0x40, // animUFlags: dir=1
                0x86, // animVFlags: dir=2, speed=(6-6)=0
                0x00, // skip
                0x00, // skip
            };

            auto defRes = rs::OldProceduralTextureDefinition::decodeFromBytes(
                7, rs::Span<const rs::u8>(bytes.data(), bytes.size()), alloc);
            if (!defRes.isOk()) {
                return fail("OldProceduralTextureDefinition: decode failed");
            }
            rs::OldProceduralTextureDefinition def = rs::move(defRes.value());
            if (!def.flag1 || !def.valid || def.size != 0x40 || def.averageHsl != 0x1234 || def.unused != 256 ||
                def.animDirU != 1 || def.animDirV != 2 || def.animSpeed != 0) {
                return fail("OldProceduralTextureDefinition: field mismatch");
            }

            rs::TextureGenerator gen(alloc);
            auto pixRes = def.procedural.getPixelsArgb(gen, 4, 4, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("OldProceduralTextureDefinition: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            for (std::size_t i = 0; i < pixels.size(); i++) {
	                if (static_cast<rs::u32>(pixels[i]) != 0xFF112233u) {
	                    return fail("OldProceduralTextureDefinition: pixel mismatch");
	                }
	            }
	        }

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: horizontal gradient.
	            std::vector<rs::u8> bytes;
	            bytes.push_back(0x01); // op count
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id: HorizontalGradient
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count
            bytes.push_back(0x00); // colour op index
            bytes.push_back(0x00); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("HorizontalGradient: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("HorizontalGradient: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 4) {
                return fail("HorizontalGradient: expected 4 pixels");
            }
            const rs::u32 expect[4] = {0x00000000u, 0xFF404040u, 0xFF808080u, 0xFFC0C0C0u};
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
                    return fail("HorizontalGradient: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: curve (linear) applied to a horizontal gradient.
            // Curve points: (0,4096) -> (4096,0), which inverts the gradient.
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: HorizontalGradient
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count
            // op0 inputs: none

            // op1: Curve
            bytes.push_back(0x01); // op id
            bytes.push_back(0x08); // type id: Curve
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // property id
            bytes.push_back(0x00); // interpolation mode: linear
            bytes.push_back(0x02); // control point count
            bytes.push_back(0x00); // x0 hi
            bytes.push_back(0x00); // x0 lo
            bytes.push_back(0x10); // y0=4096 hi
            bytes.push_back(0x00); // y0 lo
            bytes.push_back(0x10); // x1=4096 hi
            bytes.push_back(0x00); // x1 lo
            bytes.push_back(0x00); // y1 hi
            bytes.push_back(0x00); // y1 lo

            // op1 inputs: op0
            bytes.push_back(0x00);

            // colour op index, mono op index
            bytes.push_back(0x01);
            bytes.push_back(0x01);

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Curve: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Curve: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 4) {
                return fail("Curve: expected 4 pixels");
            }
            const rs::u32 expect[4] = {0xFFFFFFFFu, 0xFFC0C0C0u, 0xFF808080u, 0xFF404040u};
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
                    return fail("Curve: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: gradient map (preset 1) applied to a horizontal gradient.
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: HorizontalGradient
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count

            // op1: Gradient
            bytes.push_back(0x01); // op id
            bytes.push_back(0x0A); // type id: Gradient (10)
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // field 0
            bytes.push_back(0x01); // preset 1

            // op1 inputs: op0
            bytes.push_back(0x00);

            // colour op index, mono op index
            bytes.push_back(0x01);
            bytes.push_back(0x00);

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Gradient: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Gradient: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 4) {
                return fail("Gradient: expected 4 pixels");
            }
            const rs::u32 expect[4] = {0x00000000u, 0xFF404040u, 0xFF808080u, 0xFFC0C0C0u};
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
                    return fail("Gradient: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: blur (monochrome) applied to a horizontal gradient.
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: HorizontalGradient
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count

            // op1: Blur
            bytes.push_back(0x01); // op id
            bytes.push_back(0x05); // type id: Blur (5)
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x03); // property count
            bytes.push_back(0x00); // field 0: hExtent
            bytes.push_back(0x01); // 1
            bytes.push_back(0x01); // field 1: vExtent
            bytes.push_back(0x00); // 0
            bytes.push_back(0x02); // field 2: isMonochrome
            bytes.push_back(0x01); // true

            // op1 inputs: op0
            bytes.push_back(0x00);

            // colour op index, mono op index
            bytes.push_back(0x01);
            bytes.push_back(0x01);

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Blur: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Blur: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 4) {
                return fail("Blur: expected 4 pixels");
            }
            const rs::u32 expect[4] = {0xFF555555u, 0xFF3F3F3Fu, 0xFF7F7F7Fu, 0xFF6A6A6Au};
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
                    return fail("Blur: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: range map (monochrome) applied to a horizontal gradient.
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: HorizontalGradient
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count

            // op1: Range (defaults: min=1024,max=3072)
            bytes.push_back(0x01); // op id
            bytes.push_back(0x1E); // type id: Range (30)
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x01); // property count
            bytes.push_back(0x02); // field 2: isMonochrome
            bytes.push_back(0x01); // true

            // op1 inputs: op0
            bytes.push_back(0x00);

            // colour op index, mono op index
            bytes.push_back(0x01);
            bytes.push_back(0x01);

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Range: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Range: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::u32 expect[4] = {0xFF404040u, 0xFF606060u, 0xFF808080u, 0xFFA0A0A0u};
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
                    return fail("Range: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: mirror (monochrome) applied to a horizontal gradient.
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: HorizontalGradient
            bytes.push_back(0x00); // op id
            bytes.push_back(0x02); // type id
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count

            // op1: Mirror
            bytes.push_back(0x01); // op id
            bytes.push_back(0x09); // type id: Mirror (9)
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x03); // property count
            bytes.push_back(0x00); // field 0: invertHorizontal
            bytes.push_back(0x01); // true
            bytes.push_back(0x01); // field 1: invertVertical
            bytes.push_back(0x00); // false
            bytes.push_back(0x02); // field 2: isMonochrome
            bytes.push_back(0x01); // true

            // op1 inputs: op0
            bytes.push_back(0x00);

            // colour op index, mono op index
            bytes.push_back(0x01);
            bytes.push_back(0x01);

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Mirror: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 1, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Mirror: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            const rs::u32 expect[4] = {0xFFC0C0C0u, 0xFF808080u, 0xFF404040u, 0x00000000u};
	            for (std::size_t i = 0; i < 4; i++) {
	                if (static_cast<rs::u32>(pixels[i]) != expect[i]) {
	                    return fail("Mirror: pixel mismatch");
	                }
	            }
	        }

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: vertical gradient.
	            std::vector<rs::u8> bytes;
	            bytes.push_back(0x01); // op count
            bytes.push_back(0x00); // op id
            bytes.push_back(0x03); // type id: VerticalGradient
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x00); // property count
            bytes.push_back(0x00); // colour op index
            bytes.push_back(0x00); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("VerticalGradient: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 4, 4, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("VerticalGradient: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 16) {
                return fail("VerticalGradient: expected 16 pixels");
            }
            // Check first pixel of each row.
            const rs::u32 expectRow0 = 0x00000000u;
            const rs::u32 expectRow1 = 0xFF404040u;
            const rs::u32 expectRow2 = 0xFF808080u;
            const rs::u32 expectRow3 = 0xFFC0C0C0u;
            if (static_cast<rs::u32>(pixels[0]) != expectRow0 ||
                static_cast<rs::u32>(pixels[4]) != expectRow1 ||
                static_cast<rs::u32>(pixels[8]) != expectRow2 ||
                static_cast<rs::u32>(pixels[12]) != expectRow3) {
                return fail("VerticalGradient: row pixels mismatch");
            }
        }

        {
            // ProceduralTexture: clamp (monochrome output).
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: ConstantMonochrome (v=200)
            bytes.push_back(0x00); // op id
            bytes.push_back(0x00); // type id: ConstantMonochrome
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // field 0
            bytes.push_back(200);  // value

            // op1: Clamp(min=1000,max=2000,monochrome=1), input=op0
            bytes.push_back(0x01); // op id
            bytes.push_back(0x06); // type id: Clamp
            bytes.push_back(0xFF); // cache slot count
            bytes.push_back(0x03); // property count
            bytes.push_back(0x00); // field 0 min
            appendU16BE(bytes, 1000);
            bytes.push_back(0x01); // field 1 max
            appendU16BE(bytes, 2000);
            bytes.push_back(0x02); // field 2 monochrome flag
            bytes.push_back(0x01);
            bytes.push_back(0x00); // input connection: op0

            bytes.push_back(0x01); // colour op index
            bytes.push_back(0x01); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Clamp: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Clamp: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            if (pixels.size() != 4) {
                return fail("Clamp: expected 4 pixels");
            }
            for (std::size_t i = 0; i < 4; i++) {
                if (static_cast<rs::u32>(pixels[i]) != 0xFF7D7D7Du) {
                    return fail("Clamp: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: invert (monochrome output).
            std::vector<rs::u8> bytes;
            bytes.push_back(0x02); // op count

            // op0: ConstantMonochrome (v=100)
            bytes.push_back(0x00); // op id
            bytes.push_back(0x00); // type id: ConstantMonochrome
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(100);

            // op1: Invert(monochrome=1), input=op0
            bytes.push_back(0x01); // op id
            bytes.push_back(0x16); // type id: Invert (22)
            bytes.push_back(0xFF);
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // field 0: monochrome flag
            bytes.push_back(0x01);
            bytes.push_back(0x00); // input conn: op0

            bytes.push_back(0x01); // colour op index
            bytes.push_back(0x01); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Invert: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Invert: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            for (std::size_t i = 0; i < pixels.size(); i++) {
                if (static_cast<rs::u32>(pixels[i]) != 0xFF9B9B9Bu) {
                    return fail("Invert: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: lerp (monochrome output).
            std::vector<rs::u8> bytes;
            bytes.push_back(0x04); // op count

            // op0: ConstantMonochrome A (v=255 -> 4096)
            bytes.push_back(0x00);
            bytes.push_back(0x00);
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(255);

            // op1: ConstantMonochrome B (v=0 -> 0)
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(0);

            // op2: ConstantMonochrome C weight (v=128 -> ~2056)
            bytes.push_back(0x02);
            bytes.push_back(0x00);
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(128);

            // op3: Lerp(monochrome=1), inputs: A,B,C
            bytes.push_back(0x03);
            bytes.push_back(0x15); // type id: Lerp (21)
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00); // field 0: monochrome flag
            bytes.push_back(0x01);
            bytes.push_back(0x00); // input A -> op0
            bytes.push_back(0x01); // input B -> op1
            bytes.push_back(0x02); // input C -> op2

            bytes.push_back(0x03); // colour op index
            bytes.push_back(0x03); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Lerp: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Lerp: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            for (std::size_t i = 0; i < pixels.size(); i++) {
                if (static_cast<rs::u32>(pixels[i]) != 0xFF808080u) {
                    return fail("Lerp: pixel mismatch");
                }
            }
        }

        {
            // ProceduralTexture: arithmetic multiply (monochrome output).
            std::vector<rs::u8> bytes;
            bytes.push_back(0x03); // op count

            // op0: ConstantMonochrome (v=128 -> ~2056)
            bytes.push_back(0x00);
            bytes.push_back(0x00);
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(128);

            // op1: ConstantMonochrome (v=128)
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(0xFF);
            bytes.push_back(0x01);
            bytes.push_back(0x00);
            bytes.push_back(128);

            // op2: Arithmetic(blendMode=Multiply(3), monochrome=1), inputs: op0, op1
            bytes.push_back(0x02);
            bytes.push_back(0x07); // type id: Arithmetic
            bytes.push_back(0xFF);
            bytes.push_back(0x02); // property count
            bytes.push_back(0x00); // field 0: blend mode
            bytes.push_back(0x03);
            bytes.push_back(0x01); // field 1: monochrome flag
            bytes.push_back(0x01);
            bytes.push_back(0x00); // input A -> op0
            bytes.push_back(0x01); // input B -> op1

            bytes.push_back(0x02); // colour op index
            bytes.push_back(0x02); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("Arithmetic: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            rs::TextureGenerator gen(alloc);
            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("Arithmetic: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            for (std::size_t i = 0; i < pixels.size(); i++) {
	                if (static_cast<rs::u32>(pixels[i]) != 0xFF404040u) {
	                    return fail("Arithmetic: pixel mismatch");
	                }
	            }
	        }

	            return 0;
	        }()) return r;

	        if (int r = [&]() -> int {
	        {
	            // ProceduralTexture: TextureSource op (36) via fake external source.
	            FakeTextureSource src;
	            src.id = 5;
            src.small = true;
            src.width = 2;
            src.height = 2;
            src.pixels = {static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u)};

            rs::TextureGenerator gen(alloc);
            gen.textureSource = &src;

            std::vector<rs::u8> bytes;
            bytes.push_back(0x01); // op count
            bytes.push_back(0x00); // op id
            bytes.push_back(0x24); // type id: TextureSource (36)
            bytes.push_back(0xFF);
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // field 0: texture id
            appendU16BE(bytes, 5);
            bytes.push_back(0x00); // colour op index
            bytes.push_back(0x00); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("TextureSource: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("TextureSource: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
            for (std::size_t i = 0; i < pixels.size(); i++) {
                if (static_cast<rs::u32>(pixels[i]) != 0xFF112233u) {
                    return fail("TextureSource: pixel mismatch");
                }
            }
        }

	        {
	            // ProceduralTexture: SpriteSource op (39) via fake sprite source.
	            FakeSpriteSource src;
	            src.id = 7;
            src.width = 2;
            src.height = 2;
            src.pixels = {static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u), static_cast<rs::i32>(0xFF112233u)};

            rs::TextureGenerator gen(alloc);
            gen.spriteSource = &src;

            std::vector<rs::u8> bytes;
            bytes.push_back(0x01); // op count
            bytes.push_back(0x00); // op id
            bytes.push_back(0x27); // type id: SpriteSource (39)
            bytes.push_back(0xFF);
            bytes.push_back(0x01); // property count
            bytes.push_back(0x00); // field 0: sprite id
            appendU16BE(bytes, 7);
            bytes.push_back(0x00); // colour op index
            bytes.push_back(0x00); // mono op index

            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
            if (!texRes.isOk()) {
                return fail("SpriteSource: decode failed");
            }
            rs::ProceduralTexture tex = rs::move(texRes.value());

            auto pixRes = tex.getPixelsArgb(gen, 2, 2, false, false, 1.0f, alloc);
            if (!pixRes.isOk()) {
                return fail("SpriteSource: getPixelsArgb failed");
            }
            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            for (std::size_t i = 0; i < pixels.size(); i++) {
	                if (static_cast<rs::u32>(pixels[i]) != 0xFF112233u) {
	                    return fail("SpriteSource: pixel mismatch");
	                }
	            }
	        }

	        {
	            // ProceduralTexture: TilingSprite op (18) via fake sprite source.
	            FakeSpriteSource src;
	            src.id = 7;
	            src.width = 2;
	            src.height = 2;
	            // Distinct reds so tiling is obvious.
	            src.pixels = {
	                static_cast<rs::i32>(0xFF110000u),
	                static_cast<rs::i32>(0xFF220000u),
	                static_cast<rs::i32>(0xFF330000u),
	                static_cast<rs::i32>(0xFF440000u),
	            };

	            rs::TextureGenerator gen(alloc);
	            gen.spriteSource = &src;

	            std::vector<rs::u8> bytes;
	            bytes.push_back(0x01); // op count
	            bytes.push_back(0x00); // op id
	            bytes.push_back(0x12); // type id: TilingSprite (18)
	            bytes.push_back(0xFF);
	            bytes.push_back(0x01); // property count
	            bytes.push_back(0x00); // field 0: sprite id
	            appendU16BE(bytes, 7);
	            bytes.push_back(0x00); // colour op index
	            bytes.push_back(0x00); // mono op index

	            rs::Uint8ArrayReader reader(rs::Span<const rs::u8>(bytes.data(), bytes.size()), 0);
	            auto texRes = rs::ProceduralTexture::decode(reader, false, alloc);
	            if (!texRes.isOk()) {
	                return fail("TilingSprite: decode failed");
	            }
	            rs::ProceduralTexture tex = rs::move(texRes.value());

	            const rs::i32 width = 5;
	            const rs::i32 height = 3;
	            auto pixRes = tex.getPixelsArgb(gen, width, height, false, false, 1.0f, alloc);
	            if (!pixRes.isOk()) {
	                return fail("TilingSprite: getPixelsArgb failed");
	            }
	            rs::Vec<rs::i32> pixels = rs::move(pixRes.value());
	            if (pixels.size() != static_cast<std::size_t>(width) * static_cast<std::size_t>(height)) {
	                return fail("TilingSprite: size mismatch");
	            }

	            // Row 0: 11,22,11,22,11 (red only).
	            if (static_cast<rs::u32>(pixels[0]) != 0xFF110000u || static_cast<rs::u32>(pixels[1]) != 0xFF220000u ||
	                static_cast<rs::u32>(pixels[2]) != 0xFF110000u || static_cast<rs::u32>(pixels[3]) != 0xFF220000u ||
	                static_cast<rs::u32>(pixels[4]) != 0xFF110000u) {
	                return fail("TilingSprite: row0 mismatch");
	            }
	            // Row 1: 33,44,33,44,33.
	            const std::size_t row1 = static_cast<std::size_t>(width);
	            if (static_cast<rs::u32>(pixels[row1 + 0]) != 0xFF330000u || static_cast<rs::u32>(pixels[row1 + 1]) != 0xFF440000u ||
	                static_cast<rs::u32>(pixels[row1 + 2]) != 0xFF330000u || static_cast<rs::u32>(pixels[row1 + 3]) != 0xFF440000u ||
	                static_cast<rs::u32>(pixels[row1 + 4]) != 0xFF330000u) {
	                return fail("TilingSprite: row1 mismatch");
	            }
	            // Row 2 repeats row 0.
	            const std::size_t row2 = static_cast<std::size_t>(width) * 2;
		            if (static_cast<rs::u32>(pixels[row2 + 0]) != 0xFF110000u || static_cast<rs::u32>(pixels[row2 + 1]) != 0xFF220000u ||
		                static_cast<rs::u32>(pixels[row2 + 2]) != 0xFF110000u || static_cast<rs::u32>(pixels[row2 + 3]) != 0xFF220000u ||
		                static_cast<rs::u32>(pixels[row2 + 4]) != 0xFF110000u) {
		                return fail("TilingSprite: row2 mismatch");
		            }
		        }

		            return 0;
		        }()) return r;

		        std::cout << "OK\n";
		        return 0;
		    } catch (const std::exception& e) {
	        std::cerr << "ERROR: " << e.what() << "\n";
        return 2;
    }
}
