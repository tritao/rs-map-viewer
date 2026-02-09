#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <vector>

#include "../rs/cache/CacheInfo.hpp"
#include "../rs/cache/CacheSystem.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/io/ByteSource.hpp"
#include "../rs/cache/store/CacheStore.hpp"
#include "../rs/cache/store/SectorChainStore.hpp"

namespace rscli {

namespace fs = std::filesystem;

enum class CacheKind {
    Dat2,
    Dat,
    Legacy,
};

struct Dat2CliCache final {
    std::vector<std::unique_ptr<rs::ByteSource>> ownedSources;
    std::unique_ptr<rs::SectorChainStore> store;
    rs::CacheSystem cacheSystem;
};

struct GenericCliCache final {
    std::vector<std::unique_ptr<rs::ByteSource>> ownedSources;
    std::vector<std::shared_ptr<std::vector<rs::u8>>> ownedBuffers;
    std::unique_ptr<rs::SectorChainStore> sectorStore;
    std::unique_ptr<rs::CacheStore> legacyStore;
    rs::CacheSystem cacheSystem;
};

std::optional<CacheKind> detectCacheKind(const fs::path& cacheDir);
bool dat2HasIndexFile(const fs::path& cacheDir, int indexId);

Dat2CliCache openDat2CacheSystemForCliWithIndexIds(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    const rs::Span<const rs::i32> indexIds,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc);

GenericCliCache openDatCacheSystemForCli(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc);

GenericCliCache openLegacyCacheSystemForCli(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc);

} // namespace rscli
