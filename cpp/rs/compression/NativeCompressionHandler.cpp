#include "NativeCompressionHandler.hpp"

#include <cstring>
#include <stdexcept>

#include "../../third_party/bzip2/bzlib.h"
#include "../../third_party/miniz/miniz_tinfl.h"

namespace rs {

static u32 readU32LE(const u8* p) {
    return (static_cast<u32>(p[0]) << 0) | (static_cast<u32>(p[1]) << 8) | (static_cast<u32>(p[2]) << 16) |
           (static_cast<u32>(p[3]) << 24);
}

std::vector<u8> NativeCompressionHandler::decompressGzip(const std::vector<u8>& input) const {
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

    const u32 isize = readU32LE(input.data() + input.size() - 4);

    std::vector<u8> out;
    out.resize(static_cast<std::size_t>(isize));

    const void* deflateBuf = static_cast<const void*>(input.data() + off);
    const std::size_t deflateLen = trailerOff - off;

    const std::size_t wrote =
        tinfl_decompress_mem_to_mem(out.data(), out.size(), deflateBuf, deflateLen, 0);
    if (wrote == TINFL_DECOMPRESS_MEM_TO_MEM_FAILED) {
        throw std::runtime_error("Gzip: decompression failed");
    }
    if (wrote != out.size()) {
        // `tinfl_decompress_mem_to_mem` returns out.size() on success, but keep a guard.
        out.resize(wrote);
    }
    return out;
}

std::vector<u8> NativeCompressionHandler::decompressBzip2(const std::vector<u8>& compressed, std::size_t actualSize) const {
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

