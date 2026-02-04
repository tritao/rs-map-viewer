#include <cstddef>
#include <exception>
#include <iostream>
#include <span>
#include <string>
#include <vector>

#include "../rs/cache/format/Archive.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/types.hpp"

namespace {

static int fail(const std::string& msg) {
    std::cerr << "FAIL: " << msg << "\n";
    return 1;
}

static bool eqBytes(const std::vector<rs::u8>& a, const std::vector<rs::u8>& b) {
    if (a.size() != b.size()) return false;
    for (std::size_t i = 0; i < a.size(); i++) {
        if (a[i] != b[i]) return false;
    }
    return true;
}

} // namespace

int main() {
    try {
        rs::NativeCompressionHandler compression;

        // gzip("hello rs") created via Python's gzip.compress(payload, 9)
        const std::vector<rs::u8> payload = {'h', 'e', 'l', 'l', 'o', ' ', 'r', 's'};
        const std::vector<rs::u8> gz = {
            0x1F, 0x8B, 0x08, 0x00, 0xCA, 0x3E, 0x83, 0x69, 0x02, 0xFF, 0xCB, 0x48, 0xCD, 0xC9,
            0xC9, 0x57, 0x28, 0x2A, 0x06, 0x00, 0x0F, 0xC8, 0x5B, 0x13, 0x08, 0x00, 0x00, 0x00,
        };

        {
            const std::vector<rs::u8> out = compression.decompressGzip(std::span<const rs::u8>(gz.data(), gz.size()));
            if (!eqBytes(out, payload)) {
                return fail("decompressGzip: output mismatch");
            }
        }

        {
            // Old `.dat` caches may append a trailing u16 after the gzip member (e.g. 0x0006).
            std::vector<rs::u8> withTrailing = gz;
            withTrailing.push_back(0x00);
            withTrailing.push_back(0x06);

            const rs::Archive archive = rs::Archive::decodeOld(0, withTrailing, false, compression);
            if (archive.files().size() != 1) {
                return fail("Archive::decodeOld (gzip): expected 1 file");
            }
            if (!eqBytes(archive.files()[0].data, payload)) {
                return fail("Archive::decodeOld (gzip trailing u16): output mismatch");
            }
        }

        {
            // Strict checksum enforcement.
            std::vector<rs::u8> bad = gz;
            bad[bad.size() - 8] ^= 0x01; // corrupt CRC32
            bool threw = false;
            try {
                (void)compression.decompressGzip(std::span<const rs::u8>(bad.data(), bad.size()));
            } catch (...) {
                threw = true;
            }
            if (!threw) {
                return fail("decompressGzip: expected checksum failure");
            }
        }

        std::cout << "OK\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << "\n";
        return 2;
    }
}
