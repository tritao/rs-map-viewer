#include "CliCacheOpen.hpp"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>

#include "../rs/cache/store/DatLayout.hpp"
#include "../rs/cache/IndexId.hpp"
#include "../rs/io/FileByteSource.hpp"

namespace rscli {

static bool startsWith(const std::string& s, const char* prefix) {
    const std::size_t n = std::strlen(prefix);
    return s.size() >= n && s.compare(0, n, prefix) == 0;
}

static bool fileExists(const fs::path& p) {
    std::error_code ec;
    return fs::exists(p, ec);
}

static std::shared_ptr<std::vector<rs::u8>> readFileBytes(const fs::path& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        throw std::runtime_error("Failed to open file: " + path.string());
    }
    f.seekg(0, std::ios::end);
    const std::streamoff len = f.tellg();
    f.seekg(0, std::ios::beg);
    if (len < 0) {
        throw std::runtime_error("Invalid file length: " + path.string());
    }
    auto out = std::make_shared<std::vector<rs::u8>>();
    out->resize(static_cast<std::size_t>(len));
    if (len > 0) {
        f.read(reinterpret_cast<char*>(out->data()), len);
        if (!f) {
            throw std::runtime_error("Failed to read file: " + path.string());
        }
    }
    return out;
}

static std::vector<std::string> parseJsonStringArray(std::string_view s) {
    std::vector<std::string> out;

    std::size_t i = 0;
    const auto skipWs = [&]() {
        while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) i++;
    };

    skipWs();
    if (i >= s.size() || s[i] != '[') {
        throw std::runtime_error("maps.json: expected '['");
    }
    i++;
    skipWs();
    if (i < s.size() && s[i] == ']') {
        return out;
    }

    while (i < s.size()) {
        skipWs();
        if (i >= s.size() || s[i] != '"') {
            throw std::runtime_error("maps.json: expected string");
        }
        i++;
        std::string value;
        while (i < s.size()) {
            const char c = s[i++];
            if (c == '"') {
                break;
            }
            if (c == '\\') {
                if (i >= s.size()) {
                    throw std::runtime_error("maps.json: truncated escape");
                }
                const char e = s[i++];
                switch (e) {
                    case '"': value.push_back('"'); break;
                    case '\\': value.push_back('\\'); break;
                    case '/': value.push_back('/'); break;
                    case 'b': value.push_back('\b'); break;
                    case 'f': value.push_back('\f'); break;
                    case 'n': value.push_back('\n'); break;
                    case 'r': value.push_back('\r'); break;
                    case 't': value.push_back('\t'); break;
                    default: throw std::runtime_error("maps.json: unsupported escape");
                }
                continue;
            }
            value.push_back(c);
        }
        out.push_back(std::move(value));

        skipWs();
        if (i >= s.size()) {
            throw std::runtime_error("maps.json: truncated");
        }
        if (s[i] == ',') {
            i++;
            continue;
        }
        if (s[i] == ']') {
            i++;
            break;
        }
        throw std::runtime_error("maps.json: expected ',' or ']'");
    }

    return out;
}

class LegacyCliStore final : public rs::CacheStore {
public:
    std::vector<std::shared_ptr<std::vector<rs::u8>>> indexArchives;
    std::vector<std::shared_ptr<std::vector<rs::u8>>> mapArchives;

    rs::Status getIndexFileSize(rs::i32 indexId, std::size_t* outSize) const noexcept override {
        if (!outSize) return rs::Status::InvalidArgument;
        if (indexId < 0) return rs::Status::OutOfRange;
        if (indexId >= 0 && indexId <= 3) {
            *outSize = rs::IDX_ENTRY_SIZE;
            return rs::Status::Ok;
        }
        if (indexId == 4) {
            *outSize = mapArchives.size() * rs::IDX_ENTRY_SIZE;
            return rs::Status::Ok;
        }
        return rs::Status::OutOfRange;
    }

    rs::Status readArchive(rs::i32 indexId, rs::i32 archiveId, rs::Vec<rs::u8>* out) const noexcept override {
        if (!out) return rs::Status::InvalidArgument;
        out->clear();

        const std::vector<rs::u8>* src = nullptr;
        if (indexId >= 0 && indexId <= 3) {
            if (archiveId != 0) return rs::Status::NotFound;
            const std::size_t idx = static_cast<std::size_t>(indexId);
            if (idx >= indexArchives.size() || !indexArchives[idx]) return rs::Status::NotFound;
            src = indexArchives[idx].get();
        } else if (indexId == 4) {
            if (archiveId < 0) return rs::Status::OutOfRange;
            const std::size_t idx = static_cast<std::size_t>(archiveId);
            if (idx >= mapArchives.size() || !mapArchives[idx]) return rs::Status::NotFound;
            src = mapArchives[idx].get();
        } else {
            return rs::Status::OutOfRange;
        }

        auto rr = out->resize(src->size());
        if (!rr.isOk()) return rr.status();
        if (!src->empty()) {
            std::memcpy(out->data(), src->data(), src->size());
        }
        return rs::Status::Ok;
    }
};

static int detectDat2MaxIndexId(const fs::path& cacheDir) {
    int maxIdx = -1;
    for (const auto& ent : fs::directory_iterator(cacheDir)) {
        const auto name = ent.path().filename().string();
        if (!startsWith(name, "main_file_cache.idx")) {
            continue;
        }
        const std::string suffix = name.substr(std::strlen("main_file_cache.idx"));
        if (suffix == "255" || suffix.empty()) {
            continue;
        }
        bool okDigits = true;
        for (char c : suffix) {
            if (!std::isdigit(static_cast<unsigned char>(c))) {
                okDigits = false;
                break;
            }
        }
        if (!okDigits) {
            continue;
        }
        const int id = std::stoi(suffix);
        maxIdx = std::max(maxIdx, id);
    }
    return maxIdx;
}

std::optional<CacheKind> detectCacheKind(const fs::path& cacheDir) {
    const fs::path dat2Path = cacheDir / "main_file_cache.dat2";
    const fs::path idx255Path = cacheDir / "main_file_cache.idx255";
    if (fileExists(dat2Path) && fileExists(idx255Path)) {
        return CacheKind::Dat2;
    }

    const fs::path datPath = cacheDir / "main_file_cache.dat";
    if (fileExists(datPath)) {
        const fs::path idx0Path = cacheDir / "main_file_cache.idx0";
        if (fileExists(idx0Path)) {
            return CacheKind::Dat;
        }
    }

    const fs::path configPath = cacheDir / "config";
    const fs::path mediaPath = cacheDir / "media";
    const fs::path texturesPath = cacheDir / "textures";
    const fs::path modelsPath = cacheDir / "models";
    if (fileExists(configPath) && fileExists(mediaPath) && fileExists(texturesPath) && fileExists(modelsPath)) {
        return CacheKind::Legacy;
    }

    return std::nullopt;
}

bool dat2HasIndexFile(const fs::path& cacheDir, int indexId) {
    const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(indexId));
    if (!fileExists(idxPath)) {
        return false;
    }
    std::error_code ec;
    const std::uintmax_t sz = fs::file_size(idxPath, ec);
    return !ec && sz > 0;
}

Dat2CliCache openDat2CacheSystemForCliWithIndexIds(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    const rs::Span<const rs::i32> indexIds,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc) {
    const auto kindOpt = detectCacheKind(cacheDir);
    if (!kindOpt || *kindOpt != CacheKind::Dat2) {
        throw std::runtime_error("Only dat2 caches are supported");
    }

    const fs::path dataPath = cacheDir / "main_file_cache.dat2";
    const fs::path metaPath = cacheDir / "main_file_cache.idx255";
    if (!fileExists(dataPath) || !fileExists(metaPath)) {
        throw std::runtime_error("Missing dat2 cache files");
    }

    const int maxIdx = detectDat2MaxIndexId(cacheDir);
    if (maxIdx < 0) {
        throw std::runtime_error("Failed to detect max idx id");
    }

    Dat2CliCache out;
    auto addFileSource = [&](const fs::path& p) -> const rs::ByteSource* {
        const std::string pathStr = p.string();
        auto opened = rs::FileByteSource::open(pathStr.c_str());
        if (!opened.isOk()) {
            throw std::runtime_error("Failed to open file: " + pathStr);
        }
        out.ownedSources.push_back(std::make_unique<rs::FileByteSource>(std::move(opened.value())));
        return out.ownedSources.back().get();
    };

    rs::Vec<const rs::ByteSource*> indexFiles(rs::defaultAllocator());
    if (!indexFiles.resize(static_cast<std::size_t>(maxIdx + 1)).isOk()) {
        throw std::runtime_error("Out of memory");
    }
    for (std::size_t i = 0; i < indexFiles.size(); i++) {
        indexFiles[i] = nullptr;
    }

    const rs::ByteSource* dataSrc = addFileSource(dataPath);
    const rs::ByteSource* metaSrc = addFileSource(metaPath);
    for (int idx = 0; idx <= maxIdx; idx++) {
        const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(idx));
        if (!fileExists(idxPath)) continue;
        indexFiles[static_cast<std::size_t>(idx)] = addFileSource(idxPath);
    }

    out.store = std::make_unique<rs::SectorChainStore>(dataSrc, std::move(indexFiles), metaSrc);
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    if (cacheType != rs::CacheType::Dat2) {
        throw std::runtime_error("Expected cacheType=dat2 for the provided game/revision");
    }

    auto cacheSysRes = rs::CacheSystem::fromStore(cacheType, *out.store, indexIds, compression, alloc);
    if (!cacheSysRes.isOk()) {
        throw std::runtime_error("Failed to create CacheSystem");
    }
    out.cacheSystem = std::move(cacheSysRes.value());
    return out;
}

GenericCliCache openDatCacheSystemForCli(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc) {
    const fs::path dataPath = cacheDir / "main_file_cache.dat";
    if (!fileExists(dataPath)) {
        throw std::runtime_error("Missing dat cache data file");
    }

    const int maxIdx = detectDat2MaxIndexId(cacheDir);
    if (maxIdx < 0) {
        throw std::runtime_error("Failed to detect dat max idx id");
    }

    GenericCliCache out;
    auto addFileSource = [&](const fs::path& p) -> const rs::ByteSource* {
        const std::string pathStr = p.string();
        auto opened = rs::FileByteSource::open(pathStr.c_str());
        if (!opened.isOk()) {
            throw std::runtime_error("Failed to open file: " + pathStr);
        }
        out.ownedSources.push_back(std::make_unique<rs::FileByteSource>(std::move(opened.value())));
        return out.ownedSources.back().get();
    };

    rs::Vec<const rs::ByteSource*> indexFiles(rs::defaultAllocator());
    if (!indexFiles.resize(static_cast<std::size_t>(maxIdx + 1)).isOk()) {
        throw std::runtime_error("Out of memory");
    }
    for (std::size_t i = 0; i < indexFiles.size(); i++) {
        indexFiles[i] = nullptr;
    }

    const rs::ByteSource* dataSrc = addFileSource(dataPath);
    for (int idx = 0; idx <= maxIdx; idx++) {
        const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(idx));
        if (!fileExists(idxPath)) continue;
        indexFiles[static_cast<std::size_t>(idx)] = addFileSource(idxPath);
    }

    out.sectorStore = std::make_unique<rs::SectorChainStore>(dataSrc, std::move(indexFiles), nullptr);
    std::vector<rs::i32> indexIds;
    indexIds.push_back(static_cast<rs::i32>(rs::DatIndexId::configs));
    if (dat2HasIndexFile(cacheDir, static_cast<int>(rs::DatIndexId::models))) {
        indexIds.push_back(static_cast<rs::i32>(rs::DatIndexId::models));
    }
    if (dat2HasIndexFile(cacheDir, static_cast<int>(rs::DatIndexId::animations))) {
        indexIds.push_back(static_cast<rs::i32>(rs::DatIndexId::animations));
    }
    if (dat2HasIndexFile(cacheDir, static_cast<int>(rs::DatIndexId::maps))) {
        indexIds.push_back(static_cast<rs::i32>(rs::DatIndexId::maps));
    }
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    if (cacheType != rs::CacheType::Dat) {
        throw std::runtime_error("Expected cacheType=dat for the provided game/revision");
    }
    auto cacheSysRes = rs::CacheSystem::fromStore(
        cacheType, *out.sectorStore, rs::Span<const rs::i32>(indexIds.data(), indexIds.size()), compression, alloc);
    if (!cacheSysRes.isOk()) {
        throw std::runtime_error("Failed to create Dat CacheSystem");
    }
    out.cacheSystem = std::move(cacheSysRes.value());
    return out;
}

GenericCliCache openLegacyCacheSystemForCli(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc) {
    GenericCliCache out;
    auto* legacy = new LegacyCliStore();
    out.legacyStore.reset(legacy);
    legacy->indexArchives.resize(4);

    const fs::path configPath = cacheDir / "config";
    const fs::path mediaPath = cacheDir / "media";
    const fs::path texturesPath = cacheDir / "textures";
    const fs::path modelsPath = cacheDir / "models";
    if (!fileExists(configPath) || !fileExists(mediaPath) || !fileExists(texturesPath) || !fileExists(modelsPath)) {
        throw std::runtime_error("Missing required legacy cache files");
    }

    legacy->indexArchives[0] = readFileBytes(configPath);
    legacy->indexArchives[1] = readFileBytes(mediaPath);
    legacy->indexArchives[2] = readFileBytes(texturesPath);
    legacy->indexArchives[3] = readFileBytes(modelsPath);

    const fs::path mapsJsonPath = cacheDir / "maps.json";
    const fs::path mapsDir = cacheDir / "maps";
    if (fileExists(mapsJsonPath) && fileExists(mapsDir)) {
        std::ifstream f(mapsJsonPath, std::ios::binary);
        std::string json((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
        if (!json.empty()) {
            const std::vector<std::string> mapNames = parseJsonStringArray(json);
            legacy->mapArchives.reserve(mapNames.size());
            for (const std::string& name : mapNames) {
                const fs::path mapPath = mapsDir / name;
                if (fileExists(mapPath)) {
                    legacy->mapArchives.push_back(readFileBytes(mapPath));
                }
            }
        }
    }

    const std::vector<rs::i32> indexIds = {
        static_cast<rs::i32>(rs::LegacyIndexId::configs),
        static_cast<rs::i32>(rs::LegacyIndexId::media),
        static_cast<rs::i32>(rs::LegacyIndexId::textures),
        static_cast<rs::i32>(rs::LegacyIndexId::models),
        static_cast<rs::i32>(rs::LegacyIndexId::maps),
    };
    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    if (cacheType != rs::CacheType::Legacy) {
        throw std::runtime_error("Expected cacheType=legacy for the provided game/revision");
    }
    auto cacheSysRes = rs::CacheSystem::fromStore(
        cacheType, *legacy, rs::Span<const rs::i32>(indexIds.data(), indexIds.size()), compression, alloc);
    if (!cacheSysRes.isOk()) {
        throw std::runtime_error("Failed to create Legacy CacheSystem");
    }
    out.cacheSystem = std::move(cacheSysRes.value());
    return out;
}

} // namespace rscli
