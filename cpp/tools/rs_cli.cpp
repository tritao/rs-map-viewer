#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

#include "../rs/cache/Dat2CacheIndex.hpp"
#include "../rs/cache/format/Archive.hpp"
#include "../rs/cache/format/Container.hpp"
#include "../rs/cache/store/SectorChainStore.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/io/ByteSourceUtil.hpp"
#include "../rs/io/FileByteSource.hpp"
#include "../rs/io/Uint8ArrayByteSource.hpp"
#include "../rs/util/XXHash64.hpp"

namespace fs = std::filesystem;

namespace {

static void printUsage() {
    std::cerr << "Usage:\n";
    std::cerr << "  rs_cli <command> [args]\n\n";
    std::cerr << "Commands:\n";
    std::cerr << "  parity   Emit parity JSON (dat2 only for now)\n\n";
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

static int cmdParity(int argc, char** argv) {
    const ParityArgs args = parseParityArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);

    const fs::path dat2Path = cacheDir / "main_file_cache.dat2";
    const fs::path idx255Path = cacheDir / "main_file_cache.idx255";
    if (!fs::exists(dat2Path) || !fs::exists(idx255Path)) {
        throw std::runtime_error("Expected dat2 cache dir with main_file_cache.dat2 + main_file_cache.idx255");
    }

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

    std::vector<std::optional<rs::ByteSourcePtr>> indexFiles;
    indexFiles.resize(static_cast<std::size_t>(maxIdx + 1));

    rs::ByteSourcePtr dat2Src;
    rs::ByteSourcePtr idx255Src;

    if (args.fileBacked) {
        dat2Src = std::make_shared<rs::FileByteSource>(dat2Path.string());
        idx255Src = std::make_shared<rs::FileByteSource>(idx255Path.string());
        for (int i = 0; i <= maxIdx; i++) {
            const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(i));
            if (!fs::exists(idxPath)) {
                continue;
            }
            indexFiles[static_cast<std::size_t>(i)] = std::make_shared<rs::FileByteSource>(idxPath.string());
        }
    } else {
        auto dat2Bytes = readFileBytes(dat2Path);
        auto idx255Bytes = readFileBytes(idx255Path);
        dat2Src = std::make_shared<rs::Uint8ArrayByteSource>(dat2Bytes);
        idx255Src = std::make_shared<rs::Uint8ArrayByteSource>(idx255Bytes);

        for (int i = 0; i <= maxIdx; i++) {
            const fs::path idxPath = cacheDir / ("main_file_cache.idx" + std::to_string(i));
            if (!fs::exists(idxPath)) {
                continue;
            }
            auto idxBytes = readFileBytes(idxPath);
            indexFiles[static_cast<std::size_t>(i)] = std::make_shared<rs::Uint8ArrayByteSource>(idxBytes);
        }
    }

    rs::SectorChainStore store(dat2Src, indexFiles, idx255Src);
    rs::NativeCompressionHandler compression;

    std::vector<int> selectedIndexIds;
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

    for (const int indexId : selectedIndexIds) {
        const auto idxSizeOpt = store.getIndexFileSize(indexId);
        if (!idxSizeOpt) {
            continue;
        }

        const rs::Dat2CacheIndex index = rs::Dat2CacheIndex::fromDat2Store(indexId, store, compression);
        std::vector<int> archiveIds;
        archiveIds.reserve(index.getArchiveIds().size());
        for (const rs::i32 a : index.getArchiveIds()) {
            archiveIds.push_back(static_cast<int>(a));
        }
        std::sort(archiveIds.begin(), archiveIds.end());
        if (static_cast<int>(archiveIds.size()) > args.maxArchivesPerIndex) {
            archiveIds.resize(static_cast<std::size_t>(args.maxArchivesPerIndex));
        }

        for (const int archiveId : archiveIds) {
            rs::ByteSourcePtr rawSource = store.openArchiveReader(indexId, archiveId);
            if (!rawSource || rawSource->size() == 0) {
                continue;
            }

            std::vector<rs::u8> raw = rs::readAllBytes(*rawSource);
            if (raw.empty()) {
                continue;
            }

            Entry e;
            e.indexId = indexId;
            e.archiveId = archiveId;
            e.rawLen = raw.size();
            e.rawHash = rs::h64Hex(rs::xxh64(raw.data(), raw.size()));

            auto rawOwned = std::make_shared<std::vector<rs::u8>>(std::move(raw));
            rs::ByteSourcePtr rawBytes = std::make_shared<rs::Uint8ArrayByteSource>(rawOwned);
            rs::Container container = rs::Container::decodeFromSource(*rawBytes, std::nullopt, compression);

            e.payloadLen = container.data.size();
            e.payloadHash = rs::h64Hex(rs::xxh64(container.data.data(), container.data.size()));

            const auto metaOpt = index.getArchiveMeta(archiveId);
            if (metaOpt) {
                auto payloadOwned = std::make_shared<std::vector<rs::u8>>(std::move(container.data));
                rs::ByteSourcePtr payloadBytes = std::make_shared<rs::Uint8ArrayByteSource>(payloadOwned);
                rs::Archive archive = rs::Archive::decodeFromSource(*metaOpt, *payloadBytes);
                for (const auto& f : archive.files()) {
                    ParityFileEntry fe;
                    fe.fileId = static_cast<int>(f.id);
                    fe.len = f.data.size();
                    fe.xxh64 = rs::h64Hex(rs::xxh64(f.data.data(), f.data.size()));
                    e.files.push_back(std::move(fe));
                }
                std::sort(e.files.begin(), e.files.end(), [](const ParityFileEntry& a, const ParityFileEntry& b) {
                    return a.fileId < b.fileId;
                });
            }

            entries.push_back(std::move(e));
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
