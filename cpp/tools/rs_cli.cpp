#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#include "../rs/cache/ArchiveMeta.hpp"
#include "../rs/cache/CacheIndex.hpp"
#include "../rs/cache/CacheType.hpp"
#include "../rs/cache/format/Archive.hpp"
#include "../rs/cache/format/ArchiveFile.hpp"
#include "../rs/cache/format/Container.hpp"
#include "../rs/cache/store/DatLayout.hpp"
#include "../rs/cache/store/SectorChainStore.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Result.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/io/ByteSource.hpp"
#include "../rs/io/FileByteSource.hpp"
#include "../rs/io/Uint8ArrayByteSource.hpp"
#include "../rs/types.hpp"
#include "../rs/util/XXHash64.hpp"

namespace fs = std::filesystem;

namespace {

static void printUsage() {
    std::cerr << "Usage:\n";
    std::cerr << "  rs_cli <command> [args]\n\n";
    std::cerr << "Commands:\n";
    std::cerr << "  parity   Emit parity JSON (dat2/dat/legacy)\n\n";
    std::cerr << "parity args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --out <path>\n";
    std::cerr << "  --maxIndices <n>\n";
    std::cerr << "  --maxArchives <n>\n";
    std::cerr << "  --indices <comma-separated>\n";
    std::cerr << "  --file (use file-backed ByteSource)\n";
}

struct ParityArgs {
    std::string cacheNameOrPath;
    std::string outPath;
    int maxIndices = 5;
    int maxArchivesPerIndex = 200;
    std::vector<int> indices;
    bool fileBacked = false;
};

static std::string h64Hex(rs::u64 v) {
    char buf[17];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
    return std::string(buf);
}

static bool startsWith(const std::string& s, const char* prefix) {
    const std::size_t n = std::strlen(prefix);
    return s.size() >= n && s.compare(0, n, prefix) == 0;
}

static ParityArgs parseParityArgs(int argc, char** argv) {
    ParityArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--out" && i + 1 < argc) {
            args.outPath = argv[++i];
        } else if (a == "--maxIndices" && i + 1 < argc) {
            args.maxIndices = std::stoi(argv[++i]);
        } else if (a == "--maxArchives" && i + 1 < argc) {
            args.maxArchivesPerIndex = std::stoi(argv[++i]);
        } else if (a == "--indices" && i + 1 < argc) {
            std::string raw = argv[++i];
            std::size_t start = 0;
            while (start < raw.size()) {
                const std::size_t comma = raw.find(',', start);
                const std::size_t end = (comma == std::string::npos) ? raw.size() : comma;
                std::string part = raw.substr(start, end - start);
                part.erase(part.begin(),
                           std::find_if(part.begin(), part.end(), [](unsigned char c) { return !std::isspace(c); }));
                part.erase(
                    std::find_if(part.rbegin(), part.rend(), [](unsigned char c) { return !std::isspace(c); }).base(),
                    part.end());
                if (!part.empty()) {
                    args.indices.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        } else if (a == "--file") {
            args.fileBacked = true;
        }
    }
    return args;
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

static fs::path resolveCacheDir(const std::string& nameOrPath) {
    if (nameOrPath.empty()) {
        throw std::runtime_error("Missing --cache <name-or-path>");
    }
    fs::path p(nameOrPath);
    if (p.is_absolute() || nameOrPath.find('/') != std::string::npos) {
        return p;
    }
    return fs::path("caches") / p;
}

static void writeJsonEscaped(std::ostream& os, const std::string& s) {
    os << '"';
    for (char c : s) {
        switch (c) {
            case '\\': os << "\\\\"; break;
            case '"': os << "\\\""; break;
            case '\n': os << "\\n"; break;
            case '\r': os << "\\r"; break;
            case '\t': os << "\\t"; break;
            default: os << c; break;
        }
    }
    os << '"';
}

enum class CacheKind {
    Dat2,
    Dat,
    Legacy,
};

static bool fileExists(const fs::path& p) {
    std::error_code ec;
    return fs::exists(p, ec);
}

static std::optional<CacheKind> detectCacheKind(const fs::path& cacheDir) {
    const fs::path dat2Path = cacheDir / "main_file_cache.dat2";
    const fs::path idx255Path = cacheDir / "main_file_cache.idx255";
    if (fileExists(dat2Path) && fileExists(idx255Path)) {
        return CacheKind::Dat2;
    }

    const fs::path datPath = cacheDir / "main_file_cache.dat";
    if (fileExists(datPath)) {
        // Consider it a Dat cache if idx0 exists; we’ll validate more strictly while loading.
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

static std::vector<std::string> parseJsonStringArray(std::string_view s) {
    // Minimal JSON array-of-strings parser: ["a","b",...]
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
        i++; // opening quote
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

static int cmdParity(int argc, char** argv) {
    const ParityArgs args = parseParityArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    std::vector<int> selectedIndexIds;

    struct ParityFileEntry {
        int fileId;
        std::size_t len;
        std::string xxh64;
    };
    struct Entry {
        int indexId;
        int archiveId;
        std::size_t rawLen;
        std::string rawHash;
        std::optional<std::size_t> payloadLen;
        std::optional<std::string> payloadHash;
        std::vector<ParityFileEntry> files;
    };

    std::vector<Entry> entries;

    const auto kindOpt = detectCacheKind(cacheDir);
    if (!kindOpt) {
        throw std::runtime_error("Could not detect cache kind (expected dat2, dat, or legacy layout)");
    }
    const CacheKind kind = *kindOpt;

    if (kind == CacheKind::Dat2 || kind == CacheKind::Dat) {
        const bool isDat2 = kind == CacheKind::Dat2;
        const fs::path dataPath = cacheDir / (isDat2 ? "main_file_cache.dat2" : "main_file_cache.dat");
        const fs::path metaPath = cacheDir / "main_file_cache.idx255";

        // Determine index count.
        int maxIdx = -1;
        if (isDat2) {
            for (const auto& ent : fs::directory_iterator(cacheDir)) {
                const auto name = ent.path().filename().string();
                if (!startsWith(name, "main_file_cache.idx")) {
                    continue;
                }
                const std::string suffix = name.substr(std::strlen("main_file_cache.idx"));
                if (suffix == "255" || suffix.empty()) {
                    continue;
                }
                bool ok = true;
                for (char c : suffix) {
                    if (!std::isdigit(static_cast<unsigned char>(c))) {
                        ok = false;
                        break;
                    }
                }
                if (!ok) {
                    continue;
                }
                const int id = std::stoi(suffix);
                maxIdx = std::max(maxIdx, id);
            }
        } else {
            maxIdx = 4; // DAT_INDEX_COUNT = 5 (idx0..idx4)
        }

        std::vector<std::unique_ptr<rs::ByteSource>> ownedSources;
        std::vector<std::shared_ptr<std::vector<rs::u8>>> ownedBuffers;

        auto addSource = [&](const fs::path& p) -> const rs::ByteSource* {
            if (args.fileBacked) {
                const std::string pathStr = p.string();
                auto opened = rs::FileByteSource::open(pathStr.c_str());
                if (!opened.isOk()) {
                    throw std::runtime_error("Failed to open file: " + pathStr);
                }
                ownedSources.push_back(std::make_unique<rs::FileByteSource>(std::move(opened.value())));
                return ownedSources.back().get();
            }

            auto bytes = readFileBytes(p);
            ownedBuffers.push_back(bytes);
            ownedSources.push_back(std::make_unique<rs::Uint8ArrayByteSource>(bytes->data(), bytes->size()));
            return ownedSources.back().get();
        };

        rs::Vec<const rs::ByteSource*> indexFiles(rs::defaultAllocator());
        if (!indexFiles.resize(static_cast<std::size_t>(maxIdx + 1)).isOk()) {
            throw std::runtime_error("Out of memory");
        }
        for (std::size_t i = 0; i < indexFiles.size(); i++) {
            indexFiles[i] = nullptr;
        }

        const rs::ByteSource* dataSrc = addSource(dataPath);
        const rs::ByteSource* metaSrc = isDat2 ? addSource(metaPath) : nullptr;

        for (int i = 0; i <= maxIdx; i++) {
            const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(i));
            if (!fileExists(idxPath)) {
                if (!isDat2) {
                    throw std::runtime_error("Missing dat idx file: " + idxPath.string());
                }
                continue;
            }
            indexFiles[static_cast<std::size_t>(i)] = addSource(idxPath);
        }

        rs::SectorChainStore store(dataSrc, std::move(indexFiles), metaSrc);

        if (!args.indices.empty()) {
            selectedIndexIds = args.indices;
        } else {
            for (int i = 0; i <= maxIdx; i++) {
                selectedIndexIds.push_back(i);
            }
        }
        std::sort(selectedIndexIds.begin(), selectedIndexIds.end());
        if (static_cast<int>(selectedIndexIds.size()) > args.maxIndices) {
            selectedIndexIds.resize(static_cast<std::size_t>(args.maxIndices));
        }

        for (const int indexId : selectedIndexIds) {
            std::size_t idxSize = 0;
            const rs::Status idxStatus = store.getIndexFileSize(indexId, &idxSize);
            if (!rs::ok(idxStatus)) {
                continue;
            }

            if (isDat2) {
                auto indexRes = rs::CacheIndex::fromStore(rs::CacheType::Dat2, indexId, store, compression, alloc);
                if (!indexRes.isOk()) {
                    continue;
                }
                const rs::CacheIndex index = std::move(indexRes.value());

                std::vector<int> archiveIds;
                const rs::Span<const rs::i32> ids = index.archiveIds();
                archiveIds.reserve(ids.size());
                for (std::size_t i = 0; i < ids.size(); i++) {
                    const rs::i32 a = ids[i];
                    if (a < 0) continue;
                    archiveIds.push_back(static_cast<int>(a));
                }
                std::sort(archiveIds.begin(), archiveIds.end());
                if (static_cast<int>(archiveIds.size()) > args.maxArchivesPerIndex) {
                    archiveIds.resize(static_cast<std::size_t>(args.maxArchivesPerIndex));
                }

                for (const int archiveId : archiveIds) {
                    rs::Vec<rs::u8> raw(alloc);
                    const rs::Status readStatus = store.readArchive(indexId, archiveId, &raw);
                    if (!rs::ok(readStatus) || raw.size() == 0) {
                        continue;
                    }

                    Entry e;
                    e.indexId = indexId;
                    e.archiveId = archiveId;
                    e.rawLen = raw.size();
                    e.rawHash = h64Hex(rs::xxh64(raw.data(), raw.size()));

                    rs::Uint8ArrayByteSource rawBytes(raw.data(), raw.size());
                    auto containerRes = rs::Container::decodeFromSource(rawBytes, nullptr, compression, alloc);
                    if (!containerRes.isOk()) {
                        continue;
                    }
                    rs::Container container = std::move(containerRes.value());

                    e.payloadLen = container.data.size();
                    e.payloadHash = h64Hex(rs::xxh64(container.data.data(), container.data.size()));

                    rs::ArchiveMeta meta;
                    if (rs::ok(index.getArchiveMeta(archiveId, &meta))) {
                        rs::Uint8ArrayByteSource payloadBytes(container.data.data(), container.data.size());
                        auto archiveRes = rs::Archive::decodeFromSource(meta, payloadBytes, alloc);
                        if (!archiveRes.isOk()) {
                            continue;
                        }
                        rs::Archive archive = std::move(archiveRes.value());
                        const rs::Span<const rs::ArchiveFile> fs = archive.files();
                        for (std::size_t i = 0; i < fs.size(); i++) {
                            const auto& f = fs[i];
                            ParityFileEntry fe;
                            fe.fileId = static_cast<int>(f.id);
                            fe.len = f.data.size();
                            fe.xxh64 = h64Hex(rs::xxh64(f.data.data(), f.data.size()));
                            e.files.push_back(std::move(fe));
                        }
                        std::sort(e.files.begin(), e.files.end(), [](const ParityFileEntry& a, const ParityFileEntry& b) {
                            return a.fileId < b.fileId;
                        });
                    }

                    entries.push_back(std::move(e));
                }
            } else {
                // Dat: idx is 6-byte (size+sector). Archive ids are dense: 0..(idxSize/6)-1.
                const std::size_t archiveCount = idxSize / rs::IDX_ENTRY_SIZE;
                const std::size_t takeCount = std::min<std::size_t>(archiveCount, static_cast<std::size_t>(args.maxArchivesPerIndex));

                for (std::size_t archiveId = 0; archiveId < takeCount; archiveId++) {
                    rs::Vec<rs::u8> raw(alloc);
                    const rs::Status readStatus = store.readArchive(indexId, static_cast<int>(archiveId), &raw);
                    if (!rs::ok(readStatus) || raw.size() == 0) {
                        continue;
                    }

                    Entry e;
                    e.indexId = indexId;
                    e.archiveId = static_cast<int>(archiveId);
                    e.rawLen = raw.size();
                    e.rawHash = h64Hex(rs::xxh64(raw.data(), raw.size()));

                    const bool multipleFiles = indexId == 0; // DatIndexId.configs
                    auto archiveRes = rs::Archive::decodeOld(
                        static_cast<rs::i32>(archiveId),
                        rs::Span<const rs::u8>(raw.data(), raw.size()),
                        multipleFiles,
                        compression,
                        alloc);
                    if (!archiveRes.isOk()) {
                        continue;
                    }
                    rs::Archive archive = std::move(archiveRes.value());
                    const rs::Span<const rs::ArchiveFile> fs = archive.files();
                    for (std::size_t i = 0; i < fs.size(); i++) {
                        const auto& f = fs[i];
                        ParityFileEntry fe;
                        fe.fileId = static_cast<int>(f.id);
                        fe.len = f.data.size();
                        fe.xxh64 = h64Hex(rs::xxh64(f.data.data(), f.data.size()));
                        e.files.push_back(std::move(fe));
                    }
                    std::sort(e.files.begin(), e.files.end(),
                              [](const ParityFileEntry& a, const ParityFileEntry& b) { return a.fileId < b.fileId; });

                    entries.push_back(std::move(e));
                }
            }
        }
    } else {
        // Legacy: config/media/textures/models as multi-file old format; maps are raw single-file archives.
        const fs::path configPath = cacheDir / "config";
        const fs::path mediaPath = cacheDir / "media";
        const fs::path texturesPath = cacheDir / "textures";
        const fs::path modelsPath = cacheDir / "models";

        struct LegacyIndex {
            int indexId;
            fs::path filePath;
        };
        const std::vector<LegacyIndex> legacyFiles = {
            {0, configPath},
            {1, mediaPath},
            {2, texturesPath},
            {3, modelsPath},
        };

        if (!args.indices.empty()) {
            selectedIndexIds = args.indices;
        } else {
            selectedIndexIds = {0, 1, 2, 3, 4};
        }
        std::sort(selectedIndexIds.begin(), selectedIndexIds.end());
        if (static_cast<int>(selectedIndexIds.size()) > args.maxIndices) {
            selectedIndexIds.resize(static_cast<std::size_t>(args.maxIndices));
        }

        // Read maps.json if present.
        std::vector<std::string> mapNames;
        const fs::path mapsJsonPath = cacheDir / "maps.json";
        if (fileExists(mapsJsonPath)) {
            std::ifstream f(mapsJsonPath, std::ios::binary);
            std::string json((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
            if (!json.empty()) {
                mapNames = parseJsonStringArray(json);
            }
        }

        const fs::path mapsDir = cacheDir / "maps";
        std::vector<std::string> fetchedMapNames;
        if (!mapNames.empty() && fileExists(mapsDir)) {
            fetchedMapNames.reserve(mapNames.size());
            for (const auto& name : mapNames) {
                const fs::path mapPath = mapsDir / name;
                if (fileExists(mapPath)) {
                    fetchedMapNames.push_back(name);
                }
            }
        }

        for (const int indexId : selectedIndexIds) {
            if (indexId >= 0 && indexId <= 3) {
                const auto it = std::find_if(legacyFiles.begin(), legacyFiles.end(), [&](const LegacyIndex& e) {
                    return e.indexId == indexId;
                });
                if (it == legacyFiles.end()) {
                    continue;
                }
                auto rawOwned = readFileBytes(it->filePath);
                if (!rawOwned || rawOwned->empty()) {
                    continue;
                }
                const std::vector<rs::u8>& raw = *rawOwned;

                Entry e;
                e.indexId = indexId;
                e.archiveId = 0;
                e.rawLen = raw.size();
                e.rawHash = h64Hex(rs::xxh64(raw.data(), raw.size()));

                auto archiveRes = rs::Archive::decodeOld(
                    0,
                    rs::Span<const rs::u8>(raw.data(), raw.size()),
                    true,
                    compression,
                    alloc);
                if (!archiveRes.isOk()) {
                    continue;
                }
                rs::Archive archive = std::move(archiveRes.value());
                const rs::Span<const rs::ArchiveFile> fs = archive.files();
                for (std::size_t i = 0; i < fs.size(); i++) {
                    const auto& f = fs[i];
                    ParityFileEntry fe;
                    fe.fileId = static_cast<int>(f.id);
                    fe.len = f.data.size();
                    fe.xxh64 = h64Hex(rs::xxh64(f.data.data(), f.data.size()));
                    e.files.push_back(std::move(fe));
                }
                std::sort(e.files.begin(), e.files.end(), [](const ParityFileEntry& a, const ParityFileEntry& b) {
                    return a.fileId < b.fileId;
                });
                entries.push_back(std::move(e));
                continue;
            }

            if (indexId == 4) {
                // maps
                if (fetchedMapNames.empty() || !fileExists(mapsDir)) {
                    continue;
                }
                const std::size_t takeCount =
                    std::min<std::size_t>(fetchedMapNames.size(), static_cast<std::size_t>(args.maxArchivesPerIndex));
                for (std::size_t archiveId = 0; archiveId < takeCount; archiveId++) {
                    const fs::path mapPath = mapsDir / fetchedMapNames[archiveId];
                    auto rawOwned = readFileBytes(mapPath);
                    if (!rawOwned || rawOwned->empty()) {
                        continue;
                    }
                    const std::vector<rs::u8>& raw = *rawOwned;

                    Entry e;
                    e.indexId = indexId;
                    e.archiveId = static_cast<int>(archiveId);
                    e.rawLen = raw.size();
                    e.rawHash = h64Hex(rs::xxh64(raw.data(), raw.size()));

                    rs::Vec<rs::u8> data(alloc);
                    if (!data.resize(raw.size()).isOk()) {
                        continue;
                    }
                    std::memcpy(data.data(), raw.data(), raw.size());

                    auto archiveRes = rs::Archive::create(static_cast<rs::i32>(archiveId), std::move(data), alloc);
                    if (!archiveRes.isOk()) {
                        continue;
                    }
                    rs::Archive archive = std::move(archiveRes.value());
                    const rs::Span<const rs::ArchiveFile> fs = archive.files();
                    for (std::size_t i = 0; i < fs.size(); i++) {
                        const auto& f = fs[i];
                        ParityFileEntry fe;
                        fe.fileId = static_cast<int>(f.id);
                        fe.len = f.data.size();
                        fe.xxh64 = h64Hex(rs::xxh64(f.data.data(), f.data.size()));
                        e.files.push_back(std::move(fe));
                    }
                    std::sort(e.files.begin(), e.files.end(), [](const ParityFileEntry& a, const ParityFileEntry& b) {
                        return a.fileId < b.fileId;
                    });
                    entries.push_back(std::move(e));
                }
            }
        }
    }

    const std::string outPath = args.outPath.empty() ? "/tmp/rs-parity-cpp.json" : args.outPath;
    fs::create_directories(fs::path(outPath).parent_path());

    std::ofstream out(outPath, std::ios::binary);
    if (!out) {
        throw std::runtime_error("Failed to open output file: " + outPath);
    }

    out << "{\n";
    out << "  \"schema\": 1,\n";
    out << "  \"entries\": [\n";
    for (std::size_t i = 0; i < entries.size(); i++) {
        const auto& e = entries[i];
        out << "    {\n";
        out << "      \"indexId\": " << e.indexId << ",\n";
        out << "      \"archiveId\": " << e.archiveId << ",\n";
        out << "      \"raw\": { \"len\": " << e.rawLen << ", \"xxh64\": ";
        writeJsonEscaped(out, e.rawHash);
        out << " }";

        if (e.payloadLen && e.payloadHash) {
            out << ",\n      \"containerPayload\": { \"len\": " << *e.payloadLen << ", \"xxh64\": ";
            writeJsonEscaped(out, *e.payloadHash);
            out << " }";
        }

        if (!e.files.empty()) {
            out << ",\n      \"files\": [\n";
            for (std::size_t j = 0; j < e.files.size(); j++) {
                const auto& f = e.files[j];
                out << "        { \"fileId\": " << f.fileId << ", \"len\": " << f.len << ", \"xxh64\": ";
                writeJsonEscaped(out, f.xxh64);
                out << " }";
                if (j + 1 < e.files.size()) out << ",";
                out << "\n";
            }
            out << "      ]\n";
            out << "    }";
        } else {
            out << "\n    }";
        }

        if (i + 1 < entries.size()) out << ",";
        out << "\n";
    }
    out << "  ]\n";
    out << "}\n";

    std::cout << "Wrote " << entries.size() << " entries to " << outPath << "\n";
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            printUsage();
            return 2;
        }

        const std::string cmd = argv[1];
        if (cmd == "parity") {
            return cmdParity(argc - 2, argv + 2);
        }

        std::cerr << "Unknown command: " << cmd << "\n\n";
        printUsage();
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << "\n";
        return 1;
    }
}
