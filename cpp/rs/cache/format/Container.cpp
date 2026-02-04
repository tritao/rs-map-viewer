#include "Container.hpp"

#include <array>
#include <cstddef>
#include <optional>
#include <span>
#include <stdexcept>
#include <utility>
#include <vector>

#include "../../compression/CompressionHandler.hpp"
#include "../../compression/CompressionType.hpp"
#include "../../crypto/Xtea.hpp"
#include "../../io/ByteSource.hpp"
#include "../../io/Endian.hpp"
#include "../../types.hpp"

namespace rs {

Container Container::decodeFromSource(
    const ByteSource& source,
    const std::optional<std::array<u32, 4>>& key,
    const CompressionHandler& compressionHandler) {
    if (source.size() < 5) {
        throw std::runtime_error("Container: truncated header");
    }

    u8 head[5];
    source.readInto(0, head, sizeof(head));

    const CompressionType compression = static_cast<CompressionType>(head[0]);
    const i32 sizeSigned = readI32BE(head + 1);
    if (sizeSigned < 0) {
        throw std::runtime_error("Container: invalid size");
    }
    const std::size_t size = static_cast<std::size_t>(sizeSigned);

    const bool hasKey = Xtea::isValidKey(key);

    if (compression == CompressionType::None) {
        if (hasKey) {
            const std::size_t encryptedSize = 4 + size;
            const std::size_t end = 5 + encryptedSize;
            if (end > source.size()) {
                throw std::runtime_error("Container: truncated payload");
            }

            std::vector<u8> encrypted;
            encrypted.resize(encryptedSize);
            source.readInto(5, encrypted.data(), encryptedSize);

            Xtea::decryptInPlace(encrypted, 0, encryptedSize, *key);

            encrypted.resize(size);
            return Container(compression, std::move(encrypted));
        }

        const std::size_t end = 5 + size;
        if (end > source.size()) {
            throw std::runtime_error("Container: truncated payload");
        }

        std::vector<u8> out;
        out.resize(size);
        if (size) {
            source.readInto(5, out.data(), size);
        }
        return Container(compression, std::move(out));
    }

    if (compression != CompressionType::Bzip2 && compression != CompressionType::Gzip) {
        throw std::runtime_error("Container: unsupported compression type");
    }

    const std::size_t compressedSize = size;
    const std::size_t expectedMinSize = 5 + 4 + compressedSize;
    if (expectedMinSize > source.size()) {
        throw std::runtime_error("Container: truncated compressed payload");
    }

    std::size_t actualSize = 0;
    std::vector<u8> compressed;
    std::span<const u8> compressedView{};

    if (hasKey) {
        const std::size_t encryptedSize = 4 + compressedSize;
        std::vector<u8> encrypted;
        encrypted.resize(encryptedSize);
        source.readInto(5, encrypted.data(), encryptedSize);
        Xtea::decryptInPlace(encrypted, 0, encryptedSize, *key);

        actualSize = static_cast<std::size_t>(readU32BE(encrypted.data()));
        compressedView = std::span<const u8>(encrypted.data() + 4, compressedSize);

        std::vector<u8> decompressed;
        if (compression == CompressionType::Bzip2) {
            decompressed = compressionHandler.decompressBzip2(compressedView, actualSize);
        } else {
            decompressed = compressionHandler.decompressGzip(compressedView);
        }

        if (decompressed.size() != actualSize) {
            throw std::runtime_error("Container: decompressed size mismatch");
        }

        return Container(compression, std::move(decompressed));
    } else {
        u8 actualBuf[4];
        source.readInto(5, actualBuf, 4);
        actualSize = static_cast<std::size_t>(readU32BE(actualBuf));

        compressed.resize(compressedSize);
        if (compressedSize) {
            source.readInto(9, compressed.data(), compressedSize);
        }
        compressedView = std::span<const u8>(compressed.data(), compressed.size());
    }

    std::vector<u8> decompressed;
    if (compression == CompressionType::Bzip2) {
        decompressed = compressionHandler.decompressBzip2(compressedView, actualSize);
    } else {
        decompressed = compressionHandler.decompressGzip(compressedView);
    }

    if (decompressed.size() != actualSize) {
        throw std::runtime_error("Container: decompressed size mismatch");
    }

    return Container(compression, std::move(decompressed));
}

} // namespace rs
