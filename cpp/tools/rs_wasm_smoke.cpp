#include "../rs/cache/format/Archive.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/crypto/Xtea.hpp"
#include "../rs/types.hpp"

#include <array>
#include <optional>
#include <vector>

int main() {
    rs::NativeCompressionHandler compression;
    (void)compression;

    const std::optional<std::array<rs::u32, 4>> key = std::nullopt;
    const bool hasKey = rs::Xtea::isValidKey(key);
    (void)hasKey;

    rs::Archive archive = rs::Archive::create(0, std::vector<rs::u8>{});
    (void)archive;

    return 0;
}

