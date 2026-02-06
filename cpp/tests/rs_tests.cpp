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
#include "../rs/config/vartype/VarBitType.hpp"
#include "../rs/config/vartype/VarBitTypeLoader.hpp"
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

        std::cout << "OK\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << "\n";
        return 2;
    }
}
