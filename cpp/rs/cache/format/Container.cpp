#include "Container.hpp"

#include <cstddef>

#include "../../compression/CompressionHandler.hpp"
#include "../../compression/CompressionType.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Move.hpp"
#include "../../core/Result.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../crypto/Xtea.hpp"
#include "../../io/ByteSource.hpp"
#include "../../io/Endian.hpp"
#include "../../types.hpp"

namespace rs {

Result<Container> Container::decodeFromSource(
    const ByteSource& source,
    const XteaKey* key,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    if (source.size() < 5) {
        return Result<Container>::err(Status::Truncated);
    }

    u8 head[5];
    Status s = source.readInto(0, Span<u8>(head, sizeof(head)));
    if (!ok(s)) {
        return Result<Container>::err(s);
    }

    const CompressionType compression = static_cast<CompressionType>(head[0]);
    const i32 sizeSigned = readI32BE(head + 1);
    if (sizeSigned < 0) {
        return Result<Container>::err(Status::BadFormat);
    }
    const std::size_t size = static_cast<std::size_t>(sizeSigned);

    const bool hasKey = Xtea::isValidKey(key);

    if (compression == CompressionType::None) {
        if (hasKey) {
            const std::size_t encryptedSize = 4 + size;
            const std::size_t end = 5 + encryptedSize;
            if (end > source.size()) {
                return Result<Container>::err(Status::Truncated);
            }

            Vec<u8> encrypted(alloc);
            auto rr = encrypted.resize(encryptedSize);
            if (!rr.isOk()) {
                return Result<Container>::err(rr.status());
            }
            s = source.readInto(5, Span<u8>(encrypted.data(), encrypted.size()));
            if (!ok(s)) {
                return Result<Container>::err(s);
            }
            s = Xtea::decryptInPlace(Span<u8>(encrypted.data(), encrypted.size()), 0, encryptedSize, *key);
            if (!ok(s)) {
                return Result<Container>::err(s);
            }

            rr = encrypted.resize(size);
            if (!rr.isOk()) {
                return Result<Container>::err(rr.status());
            }
            return Result<Container>::ok(Container(compression, rs::move(encrypted)));
        }

        const std::size_t end = 5 + size;
        if (end > source.size()) {
            return Result<Container>::err(Status::Truncated);
        }

        Vec<u8> out(alloc);
        auto rr = out.resize(size);
        if (!rr.isOk()) {
            return Result<Container>::err(rr.status());
        }
        if (size) {
            s = source.readInto(5, Span<u8>(out.data(), out.size()));
            if (!ok(s)) {
                return Result<Container>::err(s);
            }
        }
        return Result<Container>::ok(Container(compression, rs::move(out)));
    }

    if (compression != CompressionType::Bzip2 && compression != CompressionType::Gzip) {
        return Result<Container>::err(Status::Unsupported);
    }

    const std::size_t compressedSize = size;
    const std::size_t expectedMinSize = 5 + 4 + compressedSize;
    if (expectedMinSize > source.size()) {
        return Result<Container>::err(Status::Truncated);
    }

    u32 actualSize = 0;
    Vec<u8> compressed(alloc);
    Span<const u8> compressedView;

    if (hasKey) {
        const std::size_t encryptedSize = 4 + compressedSize;
        Vec<u8> encrypted(alloc);
        auto rr = encrypted.resize(encryptedSize);
        if (!rr.isOk()) {
            return Result<Container>::err(rr.status());
        }
        s = source.readInto(5, Span<u8>(encrypted.data(), encrypted.size()));
        if (!ok(s)) {
            return Result<Container>::err(s);
        }
        s = Xtea::decryptInPlace(Span<u8>(encrypted.data(), encrypted.size()), 0, encryptedSize, *key);
        if (!ok(s)) {
            return Result<Container>::err(s);
        }

        actualSize = readU32BE(encrypted.data());
        compressedView = Span<const u8>(encrypted.data() + 4, compressedSize);

        Result<Vec<u8>> decRes = (compression == CompressionType::Bzip2)
            ? compressionHandler.decompressBzip2(compressedView, static_cast<std::size_t>(actualSize), alloc)
            : compressionHandler.decompressGzip(compressedView, alloc);

        if (!decRes.isOk()) {
            return Result<Container>::err(decRes.status());
        }
        Vec<u8> decompressed = rs::move(decRes.value());
        if (decompressed.size() != static_cast<std::size_t>(actualSize)) {
            return Result<Container>::err(Status::SizeMismatch);
        }
        return Result<Container>::ok(Container(compression, rs::move(decompressed)));
    }

    u8 actualBuf[4];
    s = source.readInto(5, Span<u8>(actualBuf, sizeof(actualBuf)));
    if (!ok(s)) {
        return Result<Container>::err(s);
    }
    actualSize = readU32BE(actualBuf);

    {
        auto rr = compressed.resize(compressedSize);
        if (!rr.isOk()) {
            return Result<Container>::err(rr.status());
        }
        if (compressedSize) {
            s = source.readInto(9, Span<u8>(compressed.data(), compressed.size()));
            if (!ok(s)) {
                return Result<Container>::err(s);
            }
        }
        compressedView = Span<const u8>(compressed.data(), compressed.size());
    }

    Result<Vec<u8>> decRes = (compression == CompressionType::Bzip2)
        ? compressionHandler.decompressBzip2(compressedView, static_cast<std::size_t>(actualSize), alloc)
        : compressionHandler.decompressGzip(compressedView, alloc);

    if (!decRes.isOk()) {
        return Result<Container>::err(decRes.status());
    }
    Vec<u8> decompressed = rs::move(decRes.value());
    if (decompressed.size() != static_cast<std::size_t>(actualSize)) {
        return Result<Container>::err(Status::SizeMismatch);
    }
    return Result<Container>::ok(Container(compression, rs::move(decompressed)));
}

} // namespace rs
