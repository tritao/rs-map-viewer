#pragma once

#include "../../compression/CompressionHandler.hpp"
#include "../../compression/CompressionType.hpp"
#include "../../crypto/Xtea.hpp"
#include "../../core/Allocator.hpp"
#include "../../core/Result.hpp"
#include "../../core/Vec.hpp"
#include "../../io/ByteSource.hpp"

namespace rs {

class Container {
public:
    static Result<Container> decodeFromSource(
        const ByteSource& source,
        const XteaKey* key,
        const CompressionHandler& compressionHandler,
        Allocator& alloc) noexcept;

    Container() : data() {}
    Container(CompressionType compression, Vec<u8> data) : compression(compression), data(rs::move(data)) {}

    CompressionType compression;
    Vec<u8> data;
};

} // namespace rs
