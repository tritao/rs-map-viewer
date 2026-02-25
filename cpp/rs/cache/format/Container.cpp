#include "Container.hpp"

#include <cstddef>
#include <cstring>

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
#include "../../io/ByteSourceUtil.hpp"
#include "../../io/Endian.hpp"
#include "../../types.hpp"

namespace rs {

Result<Container> Container::decodeFromBytes(
    Span<const u8> bytes,
    const XteaKey* key,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    if (bytes.size() < 5) {
        return Result<Container>::err(Status::Truncated);
    }

    const CompressionType compression = static_cast<CompressionType>(bytes[0]);
    const i32 sizeSigned = readI32BE(bytes.data() + 1);
    if (sizeSigned < 0) {
        return Result<Container>::err(Status::BadFormat);
    }
    const std::size_t size = static_cast<std::size_t>(sizeSigned);

    const bool hasKey = Xtea::isValidKey(key);

    if (compression == CompressionType::None) {
        if (hasKey) {
            const std::size_t encryptedSize = 4 + size;
            const std::size_t end = 5 + encryptedSize;
            if (end > bytes.size()) {
                return Result<Container>::err(Status::Truncated);
            }

            Vec<u8> encrypted(alloc);
            auto rr = encrypted.resize(encryptedSize);
            if (!rr.isOk()) {
                return Result<Container>::err(rr.status());
            }
            if (encryptedSize) {
                std::memcpy(encrypted.data(), bytes.data() + 5, encryptedSize);
            }

            Status s = Xtea::decryptInPlace(Span<u8>(encrypted.data(), encrypted.size()), 0, encryptedSize, *key);
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
        if (end > bytes.size()) {
            return Result<Container>::err(Status::Truncated);
        }

        Vec<u8> out(alloc);
        auto rr = out.resize(size);
        if (!rr.isOk()) {
            return Result<Container>::err(rr.status());
        }
        if (size) {
            std::memcpy(out.data(), bytes.data() + 5, size);
        }
        return Result<Container>::ok(Container(compression, rs::move(out)));
    }

    if (compression != CompressionType::Bzip2 && compression != CompressionType::Gzip) {
        return Result<Container>::err(Status::Unsupported);
    }

    const std::size_t compressedSize = size;
    const std::size_t expectedMinSize = 5 + 4 + compressedSize;
    if (expectedMinSize > bytes.size()) {
        return Result<Container>::err(Status::Truncated);
    }

    u32 actualSize = 0;
    Span<const u8> compressedView;
    Vec<u8> encryptedOrEmpty(alloc);

    if (hasKey) {
        const std::size_t encryptedSize = 4 + compressedSize;
        const std::size_t end = 5 + encryptedSize;
        if (end > bytes.size()) {
            return Result<Container>::err(Status::Truncated);
        }

        auto rr = encryptedOrEmpty.resize(encryptedSize);
        if (!rr.isOk()) {
            return Result<Container>::err(rr.status());
        }
        if (encryptedSize) {
            std::memcpy(encryptedOrEmpty.data(), bytes.data() + 5, encryptedSize);
        }

        Status s = Xtea::decryptInPlace(
            Span<u8>(encryptedOrEmpty.data(), encryptedOrEmpty.size()),
            0,
            encryptedSize,
            *key);
        if (!ok(s)) {
            return Result<Container>::err(s);
        }

        actualSize = readU32BE(encryptedOrEmpty.data());
        compressedView = Span<const u8>(encryptedOrEmpty.data() + 4, compressedSize);
    } else {
        actualSize = readU32BE(bytes.data() + 5);
        compressedView = bytes.subspan(9, compressedSize);
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

Result<Container> Container::decodeFromSource(
    const ByteSource& source,
    const XteaKey* key,
    const CompressionHandler& compressionHandler,
    Allocator& alloc) noexcept {
    // Prefer a contiguous view when available, otherwise copy to a temporary buffer once.
    // Keeping the core container decode bytes-based avoids coupling decoding logic to ByteSource.
    Span<const u8> view;
    if (source.tryGetView(&view)) {
        return decodeFromBytes(view, key, compressionHandler, alloc);
    }

    auto bytesRes = readAllBytes(source, alloc);
    if (!bytesRes.isOk()) {
        return Result<Container>::err(bytesRes.status());
    }
    Vec<u8> bytes = rs::move(bytesRes.value());
    return decodeFromBytes(Span<const u8>(bytes.data(), bytes.size()), key, compressionHandler, alloc);
}

} // namespace rs
