#include "NativeCompressionHandler.hpp"

#include <cstddef>
#include <cstring>
#include <mutex>
#include <span>
#include <stdexcept>
#include <vector>

#include "../../third_party/bzip2/bzlib.h"
#include "../../third_party/miniz/miniz_tinfl.h"

#include "../types.hpp"

namespace rs {

static u32 readU32LE(const u8* p) {
    return (static_cast<u32>(p[0]) << 0) | (static_cast<u32>(p[1]) << 8) | (static_cast<u32>(p[2]) << 16) |
           (static_cast<u32>(p[3]) << 24);
}

static u32 crc32(const u8* data, std::size_t len) {
    // Standard CRC-32 (IEEE 802.3), reflected.
    static u32 table[256];
    static std::once_flag once;
    std::call_once(once, []() {
        for (u32 n = 0; n < 256; n++) {
            u32 c = n;
            for (int k = 0; k < 8; k++) {
                c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            }
            table[n] = c;
        }
    });

    u32 c = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < len; i++) {
        c = table[(c ^ data[i]) & 0xFFu] ^ (c >> 8);
    }
    return c ^ 0xFFFFFFFFu;
}

std::vector<u8> NativeCompressionHandler::decompressGzip(std::span<const u8> input) const {
    // Keep this relatively low for wasm/fuzz-safety. Can be raised if we see real cache data exceed it.
    static constexpr std::size_t MAX_GZIP_OUTPUT_BYTES = 256u * 1024u * 1024u;

    // gzip format: RFC1952
    if (input.size() < 18) {
        throw std::runtime_error("Gzip: truncated input");
    }
    if (input[0] != 0x1F || input[1] != 0x8B) {
        throw std::runtime_error("Gzip: invalid magic");
    }
    if (input[2] != 8) {
        throw std::runtime_error("Gzip: unsupported compression method");
    }

    const u8 flg = input[3];

    std::size_t off = 10; // base header size

    // FEXTRA
    if (flg & 0x04) {
        if (off + 2 > input.size()) {
            throw std::runtime_error("Gzip: truncated FEXTRA");
        }
        const u16 xlen = static_cast<u16>(input[off] | (static_cast<u16>(input[off + 1]) << 8));
        off += 2;
        if (off + xlen > input.size()) {
            throw std::runtime_error("Gzip: truncated FEXTRA data");
        }
        off += xlen;
    }

    // FNAME
    if (flg & 0x08) {
        while (off < input.size() && input[off] != 0) {
            off++;
        }
        if (off >= input.size()) {
            throw std::runtime_error("Gzip: unterminated FNAME");
        }
        off++;
    }

    // FCOMMENT
    if (flg & 0x10) {
        while (off < input.size() && input[off] != 0) {
            off++;
        }
        if (off >= input.size()) {
            throw std::runtime_error("Gzip: unterminated FCOMMENT");
        }
        off++;
    }

    // FHCRC
    if (flg & 0x02) {
        if (off + 2 > input.size()) {
            throw std::runtime_error("Gzip: truncated FHCRC");
        }
        off += 2;
    }

    if (off >= input.size() || input.size() < off + 8) {
        throw std::runtime_error("Gzip: truncated");
    }

    const std::size_t trailerOff = input.size() - 8;
    if (trailerOff <= off) {
        throw std::runtime_error("Gzip: invalid offsets");
    }

    const u32 expectedCrc = readU32LE(input.data() + trailerOff);
    const u32 expectedISize = readU32LE(input.data() + trailerOff + 4);
    const std::size_t outSize = static_cast<std::size_t>(expectedISize);
    if (outSize > MAX_GZIP_OUTPUT_BYTES) {
        throw std::runtime_error("Gzip: output too large");
    }

    const void* deflateBuf = static_cast<const void*>(input.data() + off);
    const std::size_t deflateLen = trailerOff - off;

    std::vector<u8> out;
    out.resize(outSize);

    const std::size_t wrote = tinfl_decompress_mem_to_mem(out.data(), out.size(), deflateBuf, deflateLen, 0);
    if (wrote == TINFL_DECOMPRESS_MEM_TO_MEM_FAILED) {
        throw std::runtime_error("Gzip: decompression failed");
    }
    if (wrote != out.size()) {
        throw std::runtime_error("Gzip: size mismatch");
    }

    const u32 actualCrc = crc32(out.data(), out.size());
    if (expectedCrc != actualCrc) {
        throw std::runtime_error("Gzip: checksum mismatch");
    }
    return out;
}

std::vector<u8> NativeCompressionHandler::decompressBzip2(std::span<const u8> compressed, std::size_t actualSize) const {
    // RuneScape cache bzip2 data is missing the "BZh1" header; add it.
    const u8 header[4] = {'B', 'Z', 'h', '1'};

    std::vector<u8> combined;
    combined.resize(4 + compressed.size());
    std::memcpy(combined.data(), header, 4);
    if (!compressed.empty()) {
        std::memcpy(combined.data() + 4, compressed.data(), compressed.size());
    }

    std::vector<u8> out;
    out.resize(actualSize);

    unsigned int destLen = static_cast<unsigned int>(out.size());
    unsigned int srcLen = static_cast<unsigned int>(combined.size());

    int rc = BZ2_bzBuffToBuffDecompress(
        reinterpret_cast<char*>(out.data()),
        &destLen,
        reinterpret_cast<char*>(combined.data()),
        srcLen,
        0,
        0);
    if (rc != BZ_OK) {
        throw std::runtime_error("Bzip2: decompression failed");
    }
    if (destLen != actualSize) {
        throw std::runtime_error("Bzip2: size mismatch");
    }
    return out;
}

} // namespace rs
