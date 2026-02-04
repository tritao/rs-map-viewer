#include "../rs/cache/format/Archive.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/crypto/Xtea.hpp"
#include "../rs/types.hpp"

#include <utility>

int main() {
    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;
    (void)compression;

    const bool hasKey = rs::Xtea::isValidKey(nullptr);
    (void)hasKey;

    rs::Vec<rs::u8> empty(alloc);
    auto archRes = rs::Archive::create(0, std::move(empty), alloc);
    (void)archRes;

    return 0;
}
