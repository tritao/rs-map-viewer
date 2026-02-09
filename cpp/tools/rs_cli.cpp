#include <algorithm>
#include <cctype>
#include <chrono>
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
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "../rs/cache/ArchiveMeta.hpp"
#include "../rs/cache/CacheInfo.hpp"
#include "../rs/cache/CacheIndex.hpp"
#include "../rs/cache/CacheSystem.hpp"
#include "../rs/cache/CacheType.hpp"
#include "../rs/cache/format/Archive.hpp"
#include "../rs/cache/format/ArchiveFile.hpp"
#include "../rs/cache/format/Container.hpp"
#include "../rs/cache/store/DatLayout.hpp"
#include "../rs/cache/store/CacheStore.hpp"
#include "../rs/cache/store/SectorChainStore.hpp"
#include "../rs/compression/NativeCompressionHandler.hpp"
#include "../rs/core/Allocator.hpp"
#include "../rs/core/Result.hpp"
#include "../rs/core/Span.hpp"
#include "../rs/core/Status.hpp"
#include "../rs/core/Vec.hpp"
#include "../rs/loaders/CacheRules.hpp"
#include "../rs/loaders/CacheSession.hpp"
#include "../rs/loaders/ConfigLoaders.hpp"
#include "../rs/loaders/InitError.hpp"
#include "../rs/loaders/Loaders.hpp"
#include "../rs/io/ByteSource.hpp"
#include "../rs/io/FileByteSource.hpp"
#include "../rs/io/Uint8ArrayByteSource.hpp"
#include "../rs/config/bastype/BasType.hpp"
#include "../rs/config/defaults/GraphicsDefaults.hpp"
#include "../rs/config/enumtype/EnumType.hpp"
#include "../rs/config/floortype/OverlayFloorType.hpp"
#include "../rs/config/floortype/UnderlayFloorType.hpp"
#include "../rs/config/idktype/IdkType.hpp"
#include "../rs/config/invtype/InvType.hpp"
#include "../rs/config/loctype/LocType.hpp"
#include "../rs/config/mapscenetype/MapSceneType.hpp"
#include "../rs/config/meltype/MapElementType.hpp"
#include "../rs/config/npctype/NpcType.hpp"
#include "../rs/config/objtype/ObjType.hpp"
#include "../rs/config/paramtype/ParamType.hpp"
#include "../rs/config/questtype/QuestType.hpp"
#include "../rs/config/seqtype/SeqType.hpp"
#include "../rs/config/spotanimtype/SpotAnimType.hpp"
#include "../rs/config/structtype/StructType.hpp"
#include "../rs/config/vartype/VarBitType.hpp"
#include "../rs/config/vartype/VarProvider.hpp"
#include "../rs/config/vartype/client/VarClientIntType.hpp"
#include "../rs/config/vartype/client/VarClientStrType.hpp"
#include "../rs/config/vartype/player/VarPlayerType.hpp"
#include "../rs/config/TypeDecode.hpp"
#include "../rs/texture/OldProceduralTextureLoader.hpp"
#include "../rs/texture/ProceduralTextureLoader.hpp"
#include "../rs/texture/SpriteTextureLoader.hpp"
#include "../rs/map/TerrainConstants.hpp"
#include "../rs/map/LocPlacementsDecode.hpp"
#include "../rs/map/NpcSpawnsDecode.hpp"
#include "../rs/map/TerrainSquare.hpp"
#include "../rs/map/TerrainSquareDecode.hpp"
#include "../rs/model/skeletal/SkeletalEval.hpp"
#include "../rs/types.hpp"
#include "../rs/util/XXHash64.hpp"
#include "CliCacheOpen.hpp"

namespace fs = std::filesystem;
using CacheKind = rscli::CacheKind;
using Dat2CliCache = rscli::Dat2CliCache;
using GenericCliCache = rscli::GenericCliCache;

namespace {

static void printUsage() {
    std::cerr << "Usage:\n";
    std::cerr << "  rs_cli <command> [args]\n\n";
    std::cerr << "Commands:\n";
    std::cerr << "  parity   Emit parity JSON (dat2/dat/legacy)\n\n";
    std::cerr << "  texture_hashes   Hash texture pixels for ids from a cache (dat2 only)\n\n";
    std::cerr << "  texture_op_hashes   Hash per-operation outputs for one procedural texture id (dat2 only)\n\n";
    std::cerr << "  terrain_square_hashes   Hash decoded terrain square heights for map squares (dat2 only)\n\n";
    std::cerr << "  loc_square_hashes   Hash decoded loc placements for map squares (dat2 only)\n\n";
    std::cerr << "  npc_spawn_square_hashes   Hash decoded npc spawns for map squares (dat2 only)\n\n";
    std::cerr << "  map_square_inputs_hashes   Hash combined decoded map-square inputs (dat2 only)\n\n";
    std::cerr << "  model_hashes   Hash decoded model fields for ids (dat2/dat/legacy)\n\n";
    std::cerr << "  seq_frame_hashes   Hash decoded seq-frame fields for ids (dat2/dat/legacy)\n\n";
    std::cerr << "  skeletal_seq_hashes   Hash decoded skeletal-seq fields for ids (dat2/dat/legacy)\n\n";
    std::cerr << "  skeletal_eval_hashes   Hash sampled skeletal final-matrix evaluation for seq ids\n\n";
    std::cerr << "  skeletal_eval_bench   Benchmark skeletal final-matrix evaluation throughput\n\n";
    std::cerr << "  skeletal_model_hashes   Hash model vertices after skeletal application for seq:model pairs\n\n";
    std::cerr << "  seq_type_frame_lengths   Emit effective seq frame lengths for seq ids (dat2/dat/legacy)\n\n";
    std::cerr << "  anim_selection_snapshot   Snapshot NPC/LOC animation seq selection + frame resolution (dat2/dat/legacy)\n\n";
    std::cerr << "  transform_snapshot   Snapshot NPC/LOC transform chains with varbit/varp values (dat2/dat/legacy)\n\n";
    std::cerr << "  config_type_hashes   Hash decoded config/type fields for ids (dat2 only)\n\n";
    std::cerr << "  session_contract   Validate C++ session contract for one cache\n\n";
    std::cerr << "parity args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --out <path>\n";
    std::cerr << "  --maxIndices <n>\n";
    std::cerr << "  --maxArchives <n>\n";
    std::cerr << "  --indices <comma-separated>\n";
    std::cerr << "  --file (use file-backed ByteSource)\n";
    std::cerr << "\ntexture_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "\nskeletal_eval_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "  --maxFrames <n> (default: 8)\n";
    std::cerr << "\nskeletal_eval_bench args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "  --maxFrames <n> (default: 8)\n";
    std::cerr << "  --iterations <n> (default: 100)\n";
    std::cerr << "  --warmup <n> (default: 10)\n";
    std::cerr << "\nskeletal_model_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --pairs <comma-separated seqId:modelId>\n";
    std::cerr << "  --frame <n> (default: 0)\n";
    std::cerr << "  --size <n> (default: 128)\n";
    std::cerr << "  --brightness <f> (default: 1.0)\n";
    std::cerr << "  --flipH\n";
    std::cerr << "\ntexture_op_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --id <n>\n";
    std::cerr << "  --size <n> (default: 128)\n";
    std::cerr << "  --brightness <f> (default: 1.0)\n";
    std::cerr << "  --flipH\n";
    std::cerr << "\nterrain_square_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --squares <comma-separated mapX_mapY>\n";
    std::cerr << "\nloc_square_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --squares <comma-separated mapX_mapY>\n";
    std::cerr << "\nnpc_spawn_square_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --squares <comma-separated mapX_mapY>\n";
    std::cerr << "\nmap_square_inputs_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --squares <comma-separated mapX_mapY>\n";
    std::cerr << "\nmodel_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "\nseq_frame_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "\nskeletal_seq_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "\nseq_type_frame_lengths args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "  --maxFrames <n> (default: 20)\n";
    std::cerr << "\nanim_selection_snapshot args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --npcIds <comma-separated>\n";
    std::cerr << "  --locIds <comma-separated>\n";
    std::cerr << "  --maxFrames <n> (default: 8)\n";
    std::cerr << "\ntransform_snapshot args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --npcIds <comma-separated>\n";
    std::cerr << "  --locIds <comma-separated>\n";
    std::cerr << "  --varps <comma-separated varpId=value>\n";
    std::cerr << "  --varbits <comma-separated varbitId=value>\n";
    std::cerr << "  --maxSteps <n> (default: 8)\n";
    std::cerr << "\nconfig_type_hashes args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
    std::cerr << "  --kind <underlay|overlay|varbit|enum|param|loc|npc|obj|seq|spotanim>\n";
    std::cerr << "  --ids <comma-separated>\n";
    std::cerr << "\nsession_contract args:\n";
    std::cerr << "  --cache <name-or-path>\n";
    std::cerr << "  --game <classic|runescape|oldschool>\n";
    std::cerr << "  --revision <n>\n";
}

struct ParityArgs {
    std::string cacheNameOrPath;
    std::string outPath;
    int maxIndices = 5;
    int maxArchivesPerIndex = 200;
    std::vector<int> indices;
    bool fileBacked = false;
};

struct TerrainSquareHashArgs {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<std::pair<int, int>> squares;
};

struct LocSquareHashArgs {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<std::pair<int, int>> squares;
};

using NpcSpawnSquareHashArgs = LocSquareHashArgs;

struct ConfigTypeHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::string kind;
    std::vector<int> ids;
};

struct ModelHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<int> ids;
};

struct SeqFrameHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<int> ids;
};

struct SkeletalSeqHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<int> ids;
};

struct SkeletalEvalHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int maxFrames = 8;
    std::vector<int> ids;
};

struct SkeletalEvalBenchArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int maxFrames = 8;
    int iterations = 100;
    int warmup = 10;
    std::vector<int> ids;
};

struct SkeletalModelHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int frame = 0;
    std::vector<std::pair<int, int>> pairs; // seqId:modelId
};

struct SeqTypeFrameLengthsArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int maxFrames = 20;
    std::vector<int> ids;
};

struct AnimSelectionSnapshotArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int maxFrames = 8;
    std::vector<int> npcIds;
    std::vector<int> locIds;
};

struct TransformSnapshotArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int maxSteps = 8;
    std::vector<int> npcIds;
    std::vector<int> locIds;
    std::unordered_map<int, int> varps;
    std::unordered_map<int, int> varbits;
};

struct SessionContractArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
};

static const char* statusName(rs::Status s);
static std::vector<std::string> parseJsonStringArray(std::string_view s);
static std::vector<int> parseCsvInts(const std::string& raw);

static std::string h64Hex(rs::u64 v) {
    char buf[17];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
    return std::string(buf);
}

static const char* initErrorCodeName(rs::InitErrorCode code) {
    switch (code) {
    case rs::InitErrorCode::Unsupported:
        return "unsupported";
    case rs::InitErrorCode::MissingIndex:
        return "missing_index";
    case rs::InitErrorCode::MissingArchive:
        return "missing_archive";
    case rs::InitErrorCode::MissingFile:
        return "missing_file";
    case rs::InitErrorCode::DecodeFailed:
        return "decode_failed";
    case rs::InitErrorCode::InvalidArgument:
        return "invalid_argument";
    }
    return "unknown";
}

static std::string initErrorToString(const rs::InitError& e) {
    std::string out = "InitError{code=";
    out += initErrorCodeName(e.code);
    out += " status=";
    out += statusName(e.status);
    if (e.context) {
        out += " context=";
        out += e.context;
    }
    if (e.indexId >= 0) {
        out += " indexId=";
        out += std::to_string(e.indexId);
    }
    if (e.archiveId >= 0) {
        out += " archiveId=";
        out += std::to_string(e.archiveId);
    }
    if (e.fileId >= 0) {
        out += " fileId=";
        out += std::to_string(e.fileId);
    }
    out += "}";
    return out;
}

static bool startsWith(const std::string& s, const char* prefix) {
    const std::size_t n = std::strlen(prefix);
    return s.size() >= n && s.compare(0, n, prefix) == 0;
}

template <typename HasIndexFileFn>
static std::vector<rs::i32> collectDat2IndexIdsForCacheSession(HasIndexFileFn&& hasIndexFile, bool includeMaps) {
    const int mapsIndexId = static_cast<int>(rs::Dat2IndexId::maps);
    const int animationsIndexId = static_cast<int>(rs::Dat2IndexId::animations);
    const int skeletonsIndexId = static_cast<int>(rs::Dat2IndexId::skeletons);
    const int configsIndexId = static_cast<int>(rs::Dat2IndexId::configs);
    const int modelsIndexId = static_cast<int>(rs::Dat2IndexId::models);
    const int spritesIndexId = static_cast<int>(rs::Dat2IndexId::sprites);
    const int texturesIndexId = static_cast<int>(rs::Dat2IndexId::textures);

    const int materialsIndexId = static_cast<int>(rs::Rs2IndexId::materials);
    const int defaultsIndexId = static_cast<int>(rs::Rs2IndexId::defaults);
    const int graphicDefaultsIndexId = static_cast<int>(rs::OsrsIndexId::graphicDefaults);

    // Index-config style indices (RS2 488+). Optional, but needed when present for correct CacheRules behavior.
    const int indexConfigs_locs = static_cast<int>(rs::Rs2IndexId::locs);
    const int indexConfigs_npcs = static_cast<int>(rs::Rs2IndexId::npcs);
    const int indexConfigs_objs = static_cast<int>(rs::Rs2IndexId::objs);
    const int indexConfigs_seqs = static_cast<int>(rs::Rs2IndexId::seqs);
    const int indexConfigs_varbits = static_cast<int>(rs::Rs2IndexId::varbits);

    if (includeMaps && !hasIndexFile(mapsIndexId)) {
        throw std::runtime_error("Missing maps index file (idx5)");
    }
    if (!hasIndexFile(configsIndexId)) {
        throw std::runtime_error("Missing configs index file (idx2)");
    }
    if (!hasIndexFile(spritesIndexId)) {
        throw std::runtime_error("Missing sprites index file (idx8)");
    }
    if (!hasIndexFile(texturesIndexId)) {
        throw std::runtime_error("Missing textures index file (idx9)");
    }

    std::vector<rs::i32> out;
    out.reserve(16);

    if (includeMaps) out.push_back(static_cast<rs::i32>(mapsIndexId));
    if (hasIndexFile(animationsIndexId)) out.push_back(static_cast<rs::i32>(animationsIndexId));
    if (hasIndexFile(skeletonsIndexId)) out.push_back(static_cast<rs::i32>(skeletonsIndexId));
    out.push_back(static_cast<rs::i32>(configsIndexId));
    if (hasIndexFile(modelsIndexId)) out.push_back(static_cast<rs::i32>(modelsIndexId));
    out.push_back(static_cast<rs::i32>(spritesIndexId));
    out.push_back(static_cast<rs::i32>(texturesIndexId));

    if (hasIndexFile(materialsIndexId)) out.push_back(static_cast<rs::i32>(materialsIndexId));

    if (hasIndexFile(indexConfigs_locs)) out.push_back(static_cast<rs::i32>(indexConfigs_locs));
    if (hasIndexFile(indexConfigs_npcs)) out.push_back(static_cast<rs::i32>(indexConfigs_npcs));
    if (hasIndexFile(indexConfigs_objs)) out.push_back(static_cast<rs::i32>(indexConfigs_objs));
    if (hasIndexFile(indexConfigs_seqs)) out.push_back(static_cast<rs::i32>(indexConfigs_seqs));
    if (hasIndexFile(indexConfigs_varbits)) out.push_back(static_cast<rs::i32>(indexConfigs_varbits));

    if (hasIndexFile(defaultsIndexId)) out.push_back(static_cast<rs::i32>(defaultsIndexId));
    if (hasIndexFile(graphicDefaultsIndexId)) out.push_back(static_cast<rs::i32>(graphicDefaultsIndexId));

    return out;
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

static rs::i32 fnv1a32Ints(const rs::Span<const rs::i32> ints) {
    rs::u32 h = 2166136261u;
    for (std::size_t i = 0; i < ints.size(); i++) {
        const rs::u32 x = static_cast<rs::u32>(ints[i]);
        h ^= (x) & 0xFFu;
        h *= 16777619u;
        h ^= (x >> 8) & 0xFFu;
        h *= 16777619u;
        h ^= (x >> 16) & 0xFFu;
        h *= 16777619u;
        h ^= (x >> 24) & 0xFFu;
        h *= 16777619u;
    }
    return static_cast<rs::i32>(h);
}

static rs::u32 fnv1a32UpdateInt(rs::u32 h, rs::i32 v) noexcept {
    const rs::u32 x = static_cast<rs::u32>(v);
    h ^= (x) & 0xFFu;
    h *= 16777619u;
    h ^= (x >> 8) & 0xFFu;
    h *= 16777619u;
    h ^= (x >> 16) & 0xFFu;
    h *= 16777619u;
    h ^= (x >> 24) & 0xFFu;
    h *= 16777619u;
    return h;
}

static rs::u32 fnv1a32UpdateByte(rs::u32 h, rs::u8 v) noexcept {
    h ^= static_cast<rs::u32>(v);
    h *= 16777619u;
    return h;
}

static rs::u32 fnv1a32UpdateStrBytes(rs::u32 h, const rs::Str& s) noexcept {
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(s.len));
    const auto* p = reinterpret_cast<const rs::u8*>(s.data);
    for (std::size_t i = 0; i < s.len; i++) {
        h = fnv1a32UpdateByte(h, p[i]);
    }
    return h;
}

static rs::u32 fnv1a32UpdateParams(rs::u32 h, const rs::ParamsMap& params) noexcept {
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(params.keys.size()));
    for (std::size_t i = 0; i < params.keys.size(); i++) {
        h = fnv1a32UpdateInt(h, params.keys[i]);
        const rs::ParamValue& v = params.values[i];
        h = fnv1a32UpdateInt(h, v.isString ? 1 : 0);
        if (v.isString) {
            h = fnv1a32UpdateStrBytes(h, v.stringValue);
        } else {
            h = fnv1a32UpdateInt(h, v.intValue);
        }
    }
    return h;
}

static bool fileExists(const fs::path& p) {
    std::error_code ec;
    return fs::exists(p, ec);
}

template <typename U>
static auto callPost(U& v, int) noexcept -> decltype(v.post()) {
    v.post();
}

template <typename U>
static void callPost(U&, ...) noexcept {}

template <typename T>
static rs::Status decodeTypeAndHash(
    const rs::CacheInfo& cacheInfo,
    rs::i32 typeId,
    rs::Span<const rs::u8> bytes,
    rs::Allocator& alloc,
    rs::u32 (*hashFn)(const T&),
    rs::u32* outHash) noexcept {
    if (!outHash) {
        return rs::Status::InvalidArgument;
    }
    rs::StringArena strings(alloc);
    const rs::TypeDecodeContext ctx{cacheInfo, &strings, &alloc};

    T t(typeId, cacheInfo);
    rs::Uint8ArrayReader reader(bytes, 0);
    rs::TypeDecodeError err{};
    const rs::Status s = rs::decodeType(t, reader, &err, &ctx);
    if (!rs::ok(s)) {
        return s;
    }
    callPost(t, 0);
    *outHash = hashFn(t);
    return rs::Status::Ok;
}

static Dat2CliCache openDat2CacheSystemForCli(
    const fs::path& cacheDir,
    rs::CacheInfo cacheInfo,
    rs::NativeCompressionHandler& compression,
    rs::Allocator& alloc,
    bool includeMaps) {
    const std::vector<rs::i32> indexIds = collectDat2IndexIdsForCacheSession(
        [&](int indexId) { return rscli::dat2HasIndexFile(cacheDir, indexId); },
        includeMaps);
    return rscli::openDat2CacheSystemForCliWithIndexIds(
        cacheDir,
        cacheInfo,
        rs::Span<const rs::i32>(indexIds.data(), indexIds.size()),
        compression,
        alloc);
}

static const char* statusName(rs::Status s) {
    switch (s) {
        case rs::Status::Ok: return "Ok";
        case rs::Status::InvalidArgument: return "InvalidArgument";
        case rs::Status::OutOfRange: return "OutOfRange";
        case rs::Status::Truncated: return "Truncated";
        case rs::Status::NotFound: return "NotFound";
        case rs::Status::Unsupported: return "Unsupported";
        case rs::Status::IoError: return "IoError";
        case rs::Status::OutOfMemory: return "OutOfMemory";
        case rs::Status::BadFormat: return "BadFormat";
        case rs::Status::DecompressFailed: return "DecompressFailed";
        case rs::Status::ChecksumMismatch: return "ChecksumMismatch";
        case rs::Status::SizeMismatch: return "SizeMismatch";
        default: return "Unknown";
    }
}

static const char* statusErrorClass(rs::Status s) {
    switch (s) {
        case rs::Status::NotFound:
        case rs::Status::OutOfRange:
            return "not_found";
        case rs::Status::BadFormat:
        case rs::Status::Truncated:
        case rs::Status::DecompressFailed:
        case rs::Status::ChecksumMismatch:
        case rs::Status::SizeMismatch:
            return "decode_failed";
        default:
            return "other";
    }
}

static const char* cacheTypeName(rs::CacheType t) {
    switch (t) {
        case rs::CacheType::Dat2: return "dat2";
        case rs::CacheType::Dat: return "dat";
        case rs::CacheType::Legacy: return "legacy";
        case rs::CacheType::Classic: return "classic";
        default: return "unknown";
    }
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

struct TextureHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    std::vector<int> ids;
    int size = 128;
    float brightness = 1.0f;
    bool flipH = false;
    int dumpId = -1;
    int dumpN = 0;
};

struct TextureOpHashArgs final {
    std::string cacheNameOrPath;
    std::string gameName;
    int revision = -1;
    int id = -1;
    int size = 128;
    float brightness = 1.0f;
    bool flipH = false;
};

static TextureHashArgs parseTextureHashArgs(int argc, char** argv) {
    TextureHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
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
                    args.ids.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        } else if (a == "--size" && i + 1 < argc) {
            args.size = std::stoi(argv[++i]);
        } else if (a == "--brightness" && i + 1 < argc) {
            args.brightness = std::stof(argv[++i]);
        } else if (a == "--flipH") {
            args.flipH = true;
        } else if (a == "--dumpId" && i + 1 < argc) {
            args.dumpId = std::stoi(argv[++i]);
        } else if (a == "--dumpN" && i + 1 < argc) {
            args.dumpN = std::stoi(argv[++i]);
        }
    }
    return args;
}

static TextureOpHashArgs parseTextureOpHashArgs(int argc, char** argv) {
    TextureOpHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--id" && i + 1 < argc) {
            args.id = std::stoi(argv[++i]);
        } else if (a == "--size" && i + 1 < argc) {
            args.size = std::stoi(argv[++i]);
        } else if (a == "--brightness" && i + 1 < argc) {
            args.brightness = std::stof(argv[++i]);
        } else if (a == "--flipH") {
            args.flipH = true;
        }
    }
    return args;
}

static ConfigTypeHashArgs parseConfigTypeHashArgs(int argc, char** argv) {
    ConfigTypeHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--kind" && i + 1 < argc) {
            args.kind = argv[++i];
        } else if (a == "--ids" && i + 1 < argc) {
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
                    args.ids.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static ModelHashArgs parseModelHashArgs(int argc, char** argv) {
    ModelHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
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
                    args.ids.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static SeqFrameHashArgs parseSeqFrameHashArgs(int argc, char** argv) {
    SeqFrameHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
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
                    args.ids.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static SkeletalSeqHashArgs parseSkeletalSeqHashArgs(int argc, char** argv) {
    SkeletalSeqHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
            args.ids = parseCsvInts(argv[++i]);
        }
    }
    return args;
}

static SkeletalEvalHashArgs parseSkeletalEvalHashArgs(int argc, char** argv) {
    SkeletalEvalHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--maxFrames" && i + 1 < argc) {
            args.maxFrames = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
            args.ids = parseCsvInts(argv[++i]);
        }
    }
    return args;
}

static SkeletalEvalBenchArgs parseSkeletalEvalBenchArgs(int argc, char** argv) {
    SkeletalEvalBenchArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--maxFrames" && i + 1 < argc) {
            args.maxFrames = std::stoi(argv[++i]);
        } else if (a == "--iterations" && i + 1 < argc) {
            args.iterations = std::stoi(argv[++i]);
        } else if (a == "--warmup" && i + 1 < argc) {
            args.warmup = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
            args.ids = parseCsvInts(argv[++i]);
        }
    }
    return args;
}

static SeqTypeFrameLengthsArgs parseSeqTypeFrameLengthsArgs(int argc, char** argv) {
    SeqTypeFrameLengthsArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--maxFrames" && i + 1 < argc) {
            args.maxFrames = std::stoi(argv[++i]);
        } else if (a == "--ids" && i + 1 < argc) {
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
                    args.ids.push_back(std::stoi(part));
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static std::vector<int> parseCsvInts(const std::string& raw) {
    std::vector<int> out;
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
            out.push_back(std::stoi(part));
        }
        start = (comma == std::string::npos) ? raw.size() : comma + 1;
    }
    return out;
}

static std::vector<std::pair<int, int>> parseCsvPairs(const std::string& raw) {
    std::vector<std::pair<int, int>> out;
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
            const std::size_t sep = part.find(':');
            if (sep == std::string::npos) {
                throw std::runtime_error("Invalid pair (expected a:b): " + part);
            }
            const int a = std::stoi(part.substr(0, sep));
            const int b = std::stoi(part.substr(sep + 1));
            out.push_back({a, b});
        }
        start = (comma == std::string::npos) ? raw.size() : comma + 1;
    }
    return out;
}

static std::unordered_map<int, int> parseCsvIntAssignments(const std::string& raw) {
    std::unordered_map<int, int> out;
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
            const std::size_t eq = part.find('=');
            if (eq == std::string::npos) {
                throw std::runtime_error("Invalid assignment (expected id=value): " + part);
            }
            std::string key = part.substr(0, eq);
            std::string value = part.substr(eq + 1);
            key.erase(key.begin(),
                      std::find_if(key.begin(), key.end(), [](unsigned char c) { return !std::isspace(c); }));
            key.erase(
                std::find_if(key.rbegin(), key.rend(), [](unsigned char c) { return !std::isspace(c); }).base(),
                key.end());
            value.erase(value.begin(),
                        std::find_if(value.begin(), value.end(), [](unsigned char c) { return !std::isspace(c); }));
            value.erase(
                std::find_if(value.rbegin(), value.rend(), [](unsigned char c) { return !std::isspace(c); }).base(),
                value.end());
            if (key.empty() || value.empty()) {
                throw std::runtime_error("Invalid assignment (empty key/value): " + part);
            }
            out[std::stoi(key)] = std::stoi(value);
        }
        start = (comma == std::string::npos) ? raw.size() : comma + 1;
    }
    return out;
}

static AnimSelectionSnapshotArgs parseAnimSelectionSnapshotArgs(int argc, char** argv) {
    AnimSelectionSnapshotArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--maxFrames" && i + 1 < argc) {
            args.maxFrames = std::stoi(argv[++i]);
        } else if (a == "--npcIds" && i + 1 < argc) {
            args.npcIds = parseCsvInts(argv[++i]);
        } else if (a == "--locIds" && i + 1 < argc) {
            args.locIds = parseCsvInts(argv[++i]);
        }
    }
    return args;
}

static TransformSnapshotArgs parseTransformSnapshotArgs(int argc, char** argv) {
    TransformSnapshotArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--maxSteps" && i + 1 < argc) {
            args.maxSteps = std::stoi(argv[++i]);
        } else if (a == "--npcIds" && i + 1 < argc) {
            args.npcIds = parseCsvInts(argv[++i]);
        } else if (a == "--locIds" && i + 1 < argc) {
            args.locIds = parseCsvInts(argv[++i]);
        } else if (a == "--varps" && i + 1 < argc) {
            args.varps = parseCsvIntAssignments(argv[++i]);
        } else if (a == "--varbits" && i + 1 < argc) {
            args.varbits = parseCsvIntAssignments(argv[++i]);
        }
    }
    return args;
}

static SkeletalModelHashArgs parseSkeletalModelHashArgs(int argc, char** argv) {
    SkeletalModelHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--frame" && i + 1 < argc) {
            args.frame = std::stoi(argv[++i]);
        } else if (a == "--pairs" && i + 1 < argc) {
            args.pairs = parseCsvPairs(argv[++i]);
        }
    }
    return args;
}

static SessionContractArgs parseSessionContractArgs(int argc, char** argv) {
    SessionContractArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        }
    }
    return args;
}

static TerrainSquareHashArgs parseTerrainSquareHashArgs(int argc, char** argv) {
    TerrainSquareHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--squares" && i + 1 < argc) {
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
                    const std::size_t us = part.find('_');
                    if (us == std::string::npos) {
                        throw std::runtime_error("Invalid --squares entry (expected mapX_mapY): " + part);
                    }
                    const int x = std::stoi(part.substr(0, us));
                    const int y = std::stoi(part.substr(us + 1));
                    args.squares.push_back({x, y});
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static LocSquareHashArgs parseLocSquareHashArgs(int argc, char** argv) {
    LocSquareHashArgs args;
    for (int i = 0; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--cache" && i + 1 < argc) {
            args.cacheNameOrPath = argv[++i];
        } else if (a == "--game" && i + 1 < argc) {
            args.gameName = argv[++i];
        } else if (a == "--revision" && i + 1 < argc) {
            args.revision = std::stoi(argv[++i]);
        } else if (a == "--squares" && i + 1 < argc) {
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
                    const std::size_t us = part.find('_');
                    if (us == std::string::npos) {
                        throw std::runtime_error("Invalid --squares entry (expected mapX_mapY): " + part);
                    }
                    const int x = std::stoi(part.substr(0, us));
                    const int y = std::stoi(part.substr(us + 1));
                    args.squares.push_back({x, y});
                }
                start = (comma == std::string::npos) ? raw.size() : comma + 1;
            }
        }
    }
    return args;
}

static rs::GameType parseGameType(const std::string& name) {
    if (name == "classic") return rs::GameType::Classic;
    if (name == "runescape") return rs::GameType::Runescape;
    if (name == "oldschool") return rs::GameType::Oldschool;
    throw std::runtime_error("Unknown --game value: " + name);
}

static bool isNewTerrainFormat(const rs::CacheInfo& cacheInfo) noexcept {
    return cacheInfo.game == rs::GameType::Oldschool && cacheInfo.revision >= 209;
}

static const char* textureModeName(rs::TextureMode m) {
    switch (m) {
        case rs::TextureMode::Sprite: return "sprite";
        case rs::TextureMode::Materials: return "materials";
        case rs::TextureMode::OldProcedural: return "old_procedural";
        case rs::TextureMode::Dat: return "dat";
        default: return "unknown";
    }
}

static rs::CacheSession createSessionOrThrow(
    rs::CacheSystem& cacheSystem,
    const rs::CacheInfo& cacheInfo,
    rs::Allocator& alloc) {
    auto sessionRes = rs::CacheSession::tryCreate(cacheSystem, cacheInfo, alloc);
    if (!sessionRes.isOk()) {
        throw std::runtime_error(initErrorToString(sessionRes.error()));
    }
    rs::CacheSession session = std::move(sessionRes.value());

    const rs::Loaders::Capabilities sessionCaps = rs::Loaders::capabilitiesFor(session);
    if (session.hasQuestTypeLoader() != sessionCaps.hasQuestTypeLoader ||
        session.hasSkeletalSeqLoader() != sessionCaps.hasSkeletalSeqLoader ||
        session.hasDistinctUnderlayTypeLoader() != sessionCaps.hasDistinctUnderlayTypeLoader) {
        throw std::runtime_error("session method/capability mismatch");
    }

    return session;
}

static void assertSessionStatusContract(rs::CacheSession& session, const rs::Loaders::Capabilities& sessionCaps) {
    const rs::UnderlayFloorType* underlay = nullptr;
    const rs::Status underlayStatus = session.tryGetUnderlayFloorType(0, &underlay);
    if (sessionCaps.hasDistinctUnderlayTypeLoader) {
        if (!(underlayStatus == rs::Status::Ok || underlayStatus == rs::Status::OutOfRange ||
              underlayStatus == rs::Status::NotFound || underlayStatus == rs::Status::Unsupported)) {
            throw std::runtime_error("underlay status mismatch for dat2 capability");
        }
    } else if (underlayStatus != rs::Status::Unsupported) {
        throw std::runtime_error("underlay status mismatch for non-dat2 capability");
    }

    const rs::CacheIndex* spritesIndex = nullptr;
    const rs::Status spriteIndexStatus = session.tryGetSpritesIndex(&spritesIndex);
    if (sessionCaps.cacheType == rs::CacheType::Dat2) {
        if (!(spriteIndexStatus == rs::Status::Ok || spriteIndexStatus == rs::Status::NotFound)) {
            throw std::runtime_error("sprites index status mismatch for dat2");
        }
    } else if (spriteIndexStatus != rs::Status::Unsupported) {
        throw std::runtime_error("sprites index status mismatch for non-dat2");
    }

    rs::i32 missingMapArchiveId = -1;
    const rs::Status missingMapStatus = session.tryGetMapArchiveId("__missing_contract_probe__", &missingMapArchiveId);
    if (!(missingMapStatus == rs::Status::NotFound || missingMapStatus == rs::Status::Unsupported)) {
        throw std::runtime_error("missing map archive status mismatch");
    }
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

    const auto kindOpt = rscli::detectCacheKind(cacheDir);
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

static int cmdTextureHashes(int argc, char** argv) {
    const TextureHashArgs args = parseTextureHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }
    if (args.size <= 0) {
        throw std::runtime_error("Invalid --size");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;

    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    const rs::TextureMode mode = session.textureMode();
    if (session.textureStatus() == rs::Status::Unsupported) {
        throw std::runtime_error("Unsupported texture mode for this cache");
    }

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"textureMode\": ";
    writeJsonEscaped(std::cout, std::string(textureModeName(mode)));
    std::cout << ",\n";
    std::cout << "  \"size\": " << args.size << ",\n";
    std::cout << "  \"brightness\": " << args.brightness << ",\n";
    std::cout << "  \"flipH\": " << (args.flipH ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];

        rs::Result<rs::Vec<rs::i32>> pixRes = session.tryGetTexturePixelsArgb(
            static_cast<rs::i32>(id),
            args.size,
            args.flipH,
            args.brightness,
            alloc);

        std::cout << "    { \"id\": " << id;
        if (!pixRes.isOk()) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(pixRes.status())));
            std::cout << ", \"statusCode\": " << static_cast<int>(pixRes.status()) << " }";
        } else {
            rs::Vec<rs::i32> pixels = std::move(pixRes.value());
            const rs::i32 hash = fnv1a32Ints(rs::Span<const rs::i32>(pixels.data(), pixels.size()));
            std::cout << ", \"ok\": true, \"hash\": " << hash;
            if (args.dumpN > 0 && args.dumpId == id) {
                const std::size_t n = std::min<std::size_t>(static_cast<std::size_t>(args.dumpN), pixels.size());
                std::cout << ", \"sample\": [";
                for (std::size_t k = 0; k < n; k++) {
                    if (k > 0) std::cout << ", ";
                    std::cout << pixels[k];
                }
                std::cout << "]";
            }
            std::cout << " }";
        }

        if (i + 1 < args.ids.size()) {
            std::cout << ",";
        }
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdTerrainSquareHashes(int argc, char** argv) {
    const TerrainSquareHashArgs args = parseTerrainSquareHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.squares.empty()) {
        throw std::runtime_error("Missing --squares <comma-separated mapX_mapY>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/true);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;
    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    rs::TerrainSquare square{};
    auto rr = square.init(alloc);
    if (!rr.isOk()) {
        throw std::runtime_error("Failed to init TerrainSquare");
    }

    const bool newFormat = isNewTerrainFormat(cacheInfo);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"newTerrainFormat\": " << (newFormat ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.squares.size(); i++) {
        const int mapX = args.squares[i].first;
        const int mapY = args.squares[i].second;

        const std::string name = "m" + std::to_string(mapX) + "_" + std::to_string(mapY);
        rs::i32 archiveId = -1;
        const rs::Status mapIdStatus = session.tryGetMapArchiveId(name.c_str(), &archiveId);

        std::cout << "    { \"mapX\": " << mapX << ", \"mapY\": " << mapY;
        if (!rs::ok(mapIdStatus) || archiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else {
            auto archRes = session.tryGetMapArchive(archiveId, alloc);
            if (!archRes.isOk()) {
                std::cout << ", \"ok\": false, \"status\": ";
                writeJsonEscaped(std::cout, std::string(statusName(archRes.status())));
                std::cout << ", \"statusCode\": " << static_cast<int>(archRes.status()) << " }";
            } else {
                rs::Archive arch = std::move(archRes.value());
                const rs::ArchiveFile* file = arch.getFile(0);
                if (!file) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string("NotFound"));
                    std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                } else {
                    const rs::Status ds = rs::decodeTerrainSquareFromBytesInto(
                        square,
                        file->data.span(),
                        newFormat,
                        mapX * rs::TerrainConstants::MAP_SQUARE_SIZE,
                        mapY * rs::TerrainConstants::MAP_SQUARE_SIZE
                    );
                    if (!rs::ok(ds)) {
                        std::cout << ", \"ok\": false, \"status\": ";
                        writeJsonEscaped(std::cout, std::string(statusName(ds)));
                        std::cout << ", \"statusCode\": " << static_cast<int>(ds) << " }";
                    } else {
                        const rs::i32 hashHeights = fnv1a32Ints(rs::Span<const rs::i32>(square.tileHeights.data(), square.tileHeights.size()));
                        std::cout << ", \"ok\": true, \"heightsHash\": " << hashHeights << " }";
                    }
                }
            }
        }

        if (i + 1 < args.squares.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static inline void skipWs(const std::string& s, std::size_t& i) {
    while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) i++;
}

static inline void expectChar(const std::string& s, std::size_t& i, char c) {
    skipWs(s, i);
    if (i >= s.size() || s[i] != c) {
        throw std::runtime_error(std::string("Invalid keys.json: expected '") + c + "'");
    }
    i++;
}

static std::unordered_map<rs::i32, rs::XteaKey> parseKeysJsonObject(const std::string& text) {
    std::unordered_map<rs::i32, rs::XteaKey> out;
    std::size_t i = 0;
    skipWs(text, i);
    expectChar(text, i, '{');
    skipWs(text, i);
    if (i < text.size() && text[i] == '}') {
        return out;
    }
    while (i < text.size()) {
        skipWs(text, i);
        expectChar(text, i, '"');
        const std::size_t keyStart = i;
        while (i < text.size() && text[i] != '"') i++;
        if (i >= text.size()) {
            throw std::runtime_error("Invalid keys.json: unterminated key string");
        }
        const std::string keyStr = text.substr(keyStart, i - keyStart);
        i++; // closing "
        const rs::i32 archiveId = static_cast<rs::i32>(std::stoi(keyStr));

        expectChar(text, i, ':');
        expectChar(text, i, '[');

        rs::i32 parts[4]{0, 0, 0, 0};
        for (int k = 0; k < 4; k++) {
            skipWs(text, i);
            const std::size_t numStart = i;
            if (i < text.size() && (text[i] == '-' || text[i] == '+')) i++;
            while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) i++;
            if (numStart == i) {
                throw std::runtime_error("Invalid keys.json: expected int");
            }
            const long long v = std::stoll(text.substr(numStart, i - numStart));
            parts[k] = static_cast<rs::i32>(v);
            skipWs(text, i);
            if (k < 3) {
                expectChar(text, i, ',');
            }
        }
        expectChar(text, i, ']');

        rs::XteaKey key{};
        key.k[0] = parts[0];
        key.k[1] = parts[1];
        key.k[2] = parts[2];
        key.k[3] = parts[3];
        out.emplace(archiveId, key);

        skipWs(text, i);
        if (i < text.size() && text[i] == ',') {
            i++;
            continue;
        }
        if (i < text.size() && text[i] == '}') {
            i++;
            break;
        }
        skipWs(text, i);
        if (i < text.size() && text[i] == '}') {
            i++;
            break;
        }
        if (i >= text.size()) {
            break;
        }
        throw std::runtime_error("Invalid keys.json: expected ',' or '}'");
    }

    return out;
}

static std::unordered_map<rs::i32, rs::XteaKey> loadKeysJsonIfPresent(const fs::path& cacheDir) {
    const fs::path p = cacheDir / "keys.json";
    std::error_code ec;
    if (!fs::exists(p, ec)) {
        return {};
    }
    std::ifstream f(p, std::ios::binary);
    if (!f) {
        throw std::runtime_error("Failed to open keys.json: " + p.string());
    }
    std::string content;
    f.seekg(0, std::ios::end);
    const std::streamoff len = f.tellg();
    f.seekg(0, std::ios::beg);
    if (len > 0) {
        content.resize(static_cast<std::size_t>(len));
        f.read(content.data(), len);
    }
    return parseKeysJsonObject(content);
}

static int cmdLocSquareHashes(int argc, char** argv) {
    const LocSquareHashArgs args = parseLocSquareHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.squares.empty()) {
        throw std::runtime_error("Missing --squares <comma-separated mapX_mapY>");
    }

    const std::unordered_map<rs::i32, rs::XteaKey> keysByArchiveId = loadKeysJsonIfPresent(cacheDir);

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;
    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);
    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/true);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;

    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.squares.size(); i++) {
        const int mapX = args.squares[i].first;
        const int mapY = args.squares[i].second;

        const std::string name = "l" + std::to_string(mapX) + "_" + std::to_string(mapY);
        rs::i32 archiveId = -1;
        const rs::Status mapIdStatus = session.tryGetMapArchiveId(name.c_str(), &archiveId);

        std::cout << "    { \"mapX\": " << mapX << ", \"mapY\": " << mapY;
        if (!rs::ok(mapIdStatus) || archiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else {
            const rs::XteaKey* keyPtr = nullptr;
            const auto it = keysByArchiveId.find(archiveId);
            if (it != keysByArchiveId.end()) {
                keyPtr = &it->second;
            }

            auto archRes = session.tryGetMapArchiveKey(archiveId, keyPtr, alloc);
            if (!archRes.isOk()) {
                std::cout << ", \"ok\": false, \"status\": ";
                writeJsonEscaped(std::cout, std::string(statusName(archRes.status())));
                std::cout << ", \"statusCode\": " << static_cast<int>(archRes.status()) << " }";
            } else {
                rs::Archive arch = std::move(archRes.value());
                const rs::ArchiveFile* file = arch.getFile(0);
                if (!file) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string("NotFound"));
                    std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                } else {
                    rs::Vec<rs::LocPlacement> placements(alloc);
                    const rs::Status ds = rs::decodeLocPlacementsFromBytes(file->data.span(), &placements, alloc);
                    if (!rs::ok(ds)) {
                        std::cout << ", \"ok\": false, \"status\": ";
                        writeJsonEscaped(std::cout, std::string(statusName(ds)));
                        std::cout << ", \"statusCode\": " << static_cast<int>(ds) << " }";
                    } else {
                        rs::u32 h = 2166136261u;
                        for (std::size_t pi = 0; pi < placements.size(); pi++) {
                            const rs::LocPlacement& p = placements[pi];
                            h = fnv1a32UpdateInt(h, p.id);
                            h = fnv1a32UpdateInt(h, p.level);
                            h = fnv1a32UpdateInt(h, p.localX);
                            h = fnv1a32UpdateInt(h, p.localY);
                            h = fnv1a32UpdateInt(h, p.type);
                            h = fnv1a32UpdateInt(h, p.rotation);
                        }
                        std::cout << ", \"ok\": true, \"placementsHash\": " << static_cast<rs::i32>(h) << ", \"count\": " << placements.size() << " }";
                    }
                }
            }
        }

        if (i + 1 < args.squares.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdNpcSpawnSquareHashes(int argc, char** argv) {
    const NpcSpawnSquareHashArgs args = parseLocSquareHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.squares.empty()) {
        throw std::runtime_error("Missing --squares <comma-separated mapX_mapY>");
    }

    const std::unordered_map<rs::i32, rs::XteaKey> keysByArchiveId = loadKeysJsonIfPresent(cacheDir);

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/true);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;

    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    rs::TerrainSquare terrain{};
    auto rr = terrain.init(alloc);
    if (!rr.isOk()) {
        throw std::runtime_error("Failed to init TerrainSquare");
    }
    const bool newFormat = isNewTerrainFormat(cacheInfo);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.squares.size(); i++) {
        const int mapX = args.squares[i].first;
        const int mapY = args.squares[i].second;

        const std::string locName = "l" + std::to_string(mapX) + "_" + std::to_string(mapY);
        const std::string npcName = "n" + std::to_string(mapX) + "_" + std::to_string(mapY);
        const std::string terrainName = "m" + std::to_string(mapX) + "_" + std::to_string(mapY);

        rs::i32 locArchiveId = -1;
        rs::i32 npcArchiveId = -1;
        rs::i32 terrainArchiveId = -1;
        const rs::Status locIdStatus = session.tryGetMapArchiveId(locName.c_str(), &locArchiveId);
        const rs::Status npcIdStatus = session.tryGetMapArchiveId(npcName.c_str(), &npcArchiveId);
        const rs::Status terrainIdStatus = session.tryGetMapArchiveId(terrainName.c_str(), &terrainArchiveId);

        std::cout << "    { \"mapX\": " << mapX << ", \"mapY\": " << mapY;
        if (!rs::ok(npcIdStatus) || npcArchiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else if (!rs::ok(locIdStatus) || locArchiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else if (!rs::ok(terrainIdStatus) || terrainArchiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else {
            // Decode terrain first to get level-1 render flags for bridge adjustments.
            auto terrRes = session.tryGetMapArchive(terrainArchiveId, alloc);
            if (!terrRes.isOk()) {
                std::cout << ", \"ok\": false, \"status\": ";
                writeJsonEscaped(std::cout, std::string(statusName(terrRes.status())));
                std::cout << ", \"statusCode\": " << static_cast<int>(terrRes.status()) << " }";
            } else {
                rs::Archive terr = std::move(terrRes.value());
                const rs::ArchiveFile* terrFile = terr.getFile(0);
                if (!terrFile) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string("NotFound"));
                    std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                } else {
                    const rs::Status ts = rs::decodeTerrainSquareFromBytesInto(
                        terrain,
                        terrFile->data.span(),
                        newFormat,
                        mapX * rs::TerrainConstants::MAP_SQUARE_SIZE,
                        mapY * rs::TerrainConstants::MAP_SQUARE_SIZE
                    );
                    if (!rs::ok(ts)) {
                        std::cout << ", \"ok\": false, \"status\": ";
                        writeJsonEscaped(std::cout, std::string(statusName(ts)));
                        std::cout << ", \"statusCode\": " << static_cast<int>(ts) << " }";
                    } else {
                        const rs::XteaKey* keyPtr = nullptr;
                        const auto it = keysByArchiveId.find(locArchiveId);
                        if (it != keysByArchiveId.end()) {
                            keyPtr = &it->second;
                        }

                        auto archRes = session.tryGetMapArchiveKey(npcArchiveId, keyPtr, alloc);
                        if (!archRes.isOk()) {
                            std::cout << ", \"ok\": false, \"status\": ";
                            writeJsonEscaped(std::cout, std::string(statusName(archRes.status())));
                            std::cout << ", \"statusCode\": " << static_cast<int>(archRes.status()) << " }";
                        } else {
                            rs::Archive arch = std::move(archRes.value());
                            const rs::ArchiveFile* file = arch.getFile(0);
                            if (!file) {
                                std::cout << ", \"ok\": false, \"status\": ";
                                writeJsonEscaped(std::cout, std::string("NotFound"));
                                std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                            } else {
                                const rs::Span<const rs::u8> flagsL1(
                                    terrain.tileRenderFlags.data() + rs::TerrainSquare::idx(1, 0, 0),
                                    static_cast<std::size_t>(rs::TerrainConstants::MAP_SQUARE_SIZE) * rs::TerrainConstants::MAP_SQUARE_SIZE
                                );

                                rs::Vec<rs::NpcSpawn> spawns(alloc);
                                const rs::Status ds = rs::decodeNpcSpawnsFromBytes(
                                    flagsL1,
                                    rs::TerrainConstants::MAP_SQUARE_SIZE,
                                    0,
                                    mapX,
                                    mapY,
                                    file->data.span(),
                                    &spawns,
                                    alloc
                                );
                                if (!rs::ok(ds)) {
                                    std::cout << ", \"ok\": false, \"status\": ";
                                    writeJsonEscaped(std::cout, std::string(statusName(ds)));
                                    std::cout << ", \"statusCode\": " << static_cast<int>(ds) << " }";
                                } else {
                                    rs::u32 h = 2166136261u;
                                    for (std::size_t si = 0; si < spawns.size(); si++) {
                                        const rs::NpcSpawn& sp = spawns[si];
                                        h = fnv1a32UpdateInt(h, sp.id);
                                        h = fnv1a32UpdateInt(h, sp.x);
                                        h = fnv1a32UpdateInt(h, sp.y);
                                        h = fnv1a32UpdateInt(h, sp.level);
                                    }
                                    std::cout << ", \"ok\": true, \"spawnsHash\": " << static_cast<rs::i32>(h) << ", \"count\": " << spawns.size() << " }";
                                }
                            }
                        }
                    }
                }
            }
        }

        if (i + 1 < args.squares.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdMapSquareInputsHashes(int argc, char** argv) {
    const LocSquareHashArgs args = parseLocSquareHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.squares.empty()) {
        throw std::runtime_error("Missing --squares <comma-separated mapX_mapY>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/true);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;
    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    const std::unordered_map<rs::i32, rs::XteaKey> keysByArchiveId = loadKeysJsonIfPresent(cacheDir);

    rs::TerrainSquare terrain{};
    auto rr = terrain.init(alloc);
    if (!rr.isOk()) {
        throw std::runtime_error("Failed to init TerrainSquare");
    }
    const bool newFormat = isNewTerrainFormat(cacheInfo);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"newTerrainFormat\": " << (newFormat ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.squares.size(); i++) {
        const int mapX = args.squares[i].first;
        const int mapY = args.squares[i].second;

        const std::string terrainName = "m" + std::to_string(mapX) + "_" + std::to_string(mapY);
        const std::string locName = "l" + std::to_string(mapX) + "_" + std::to_string(mapY);
        const std::string npcName = "n" + std::to_string(mapX) + "_" + std::to_string(mapY);

        rs::i32 terrainArchiveId = -1;
        rs::i32 locArchiveId = -1;
        rs::i32 npcArchiveId = -1;
        const rs::Status terrainIdStatus = session.tryGetMapArchiveId(terrainName.c_str(), &terrainArchiveId);
        const rs::Status locIdStatus = session.tryGetMapArchiveId(locName.c_str(), &locArchiveId);
        const rs::Status npcIdStatus = session.tryGetMapArchiveId(npcName.c_str(), &npcArchiveId);

        std::cout << "    { \"mapX\": " << mapX << ", \"mapY\": " << mapY;
        if (!rs::ok(terrainIdStatus) || !rs::ok(locIdStatus) || terrainArchiveId < 0 || locArchiveId < 0) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string("NotFound"));
            std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
        } else {
            auto terrRes = session.tryGetMapArchive(terrainArchiveId, alloc);
            if (!terrRes.isOk()) {
                std::cout << ", \"ok\": false, \"status\": ";
                writeJsonEscaped(std::cout, std::string(statusName(terrRes.status())));
                std::cout << ", \"statusCode\": " << static_cast<int>(terrRes.status()) << " }";
            } else {
                rs::Archive terr = std::move(terrRes.value());
                const rs::ArchiveFile* terrFile = terr.getFile(0);
                if (!terrFile) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string("NotFound"));
                    std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                } else {
                    const rs::Status ts = rs::decodeTerrainSquareFromBytesInto(
                        terrain,
                        terrFile->data.span(),
                        newFormat,
                        mapX * rs::TerrainConstants::MAP_SQUARE_SIZE,
                        mapY * rs::TerrainConstants::MAP_SQUARE_SIZE
                    );
                    if (!rs::ok(ts)) {
                        std::cout << ", \"ok\": false, \"status\": ";
                        writeJsonEscaped(std::cout, std::string(statusName(ts)));
                        std::cout << ", \"statusCode\": " << static_cast<int>(ts) << " }";
                    } else {
                        const rs::XteaKey* keyPtr = nullptr;
                        const auto itKey = keysByArchiveId.find(locArchiveId);
                        if (itKey != keysByArchiveId.end()) {
                            keyPtr = &itKey->second;
                        }

                        auto locRes = session.tryGetMapArchiveKey(locArchiveId, keyPtr, alloc);
                        if (!locRes.isOk()) {
                            std::cout << ", \"ok\": false, \"status\": ";
                            writeJsonEscaped(std::cout, std::string(statusName(locRes.status())));
                            std::cout << ", \"statusCode\": " << static_cast<int>(locRes.status()) << " }";
                        } else {
                            rs::Archive loc = std::move(locRes.value());
                            const rs::ArchiveFile* locFile = loc.getFile(0);
                            if (!locFile) {
                                std::cout << ", \"ok\": false, \"status\": ";
                                writeJsonEscaped(std::cout, std::string("NotFound"));
                                std::cout << ", \"statusCode\": " << static_cast<int>(rs::Status::NotFound) << " }";
                            } else {
                                rs::Vec<rs::LocPlacement> placements(alloc);
                                const rs::Status ls = rs::decodeLocPlacementsFromBytes(locFile->data.span(), &placements, alloc);
                                if (!rs::ok(ls)) {
                                    std::cout << ", \"ok\": false, \"status\": ";
                                    writeJsonEscaped(std::cout, std::string(statusName(ls)));
                                    std::cout << ", \"statusCode\": " << static_cast<int>(ls) << " }";
                                } else {
                                    rs::Vec<rs::NpcSpawn> spawns(alloc);
                                    bool hasNpc = false;
                                    rs::Status ns = rs::Status::Ok;

                                    if (rs::ok(npcIdStatus) && npcArchiveId >= 0) {
                                        auto npcRes = session.tryGetMapArchiveKey(npcArchiveId, keyPtr, alloc);
                                        if (npcRes.isOk()) {
                                            rs::Archive npc = std::move(npcRes.value());
                                            const rs::ArchiveFile* npcFile = npc.getFile(0);
                                            if (npcFile) {
                                                const rs::Span<const rs::u8> flagsL1(
                                                    terrain.tileRenderFlags.data() + rs::TerrainSquare::idx(1, 0, 0),
                                                    static_cast<std::size_t>(rs::TerrainConstants::MAP_SQUARE_SIZE) * rs::TerrainConstants::MAP_SQUARE_SIZE
                                                );
                                                ns = rs::decodeNpcSpawnsFromBytes(
                                                    flagsL1,
                                                    rs::TerrainConstants::MAP_SQUARE_SIZE,
                                                    0,
                                                    mapX,
                                                    mapY,
                                                    npcFile->data.span(),
                                                    &spawns,
                                                    alloc
                                                );
                                                hasNpc = rs::ok(ns);
                                            }
                                        }
                                    }

                                    rs::u32 h = 2166136261u;
                                    // Section tags (reduce accidental collisions).
                                    h = fnv1a32UpdateInt(h, 0x54455252); // 'TERR'
                                    for (std::size_t k = 0; k < terrain.tileHeights.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileHeights[k]);
                                    }
                                    h = fnv1a32UpdateInt(h, 0x464c4147); // 'FLAG'
                                    for (std::size_t k = 0; k < terrain.tileRenderFlags.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileRenderFlags[k]);
                                    }
                                    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
                                    for (std::size_t k = 0; k < terrain.tileUnderlays.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileUnderlays[k]);
                                    }
                                    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
                                    for (std::size_t k = 0; k < terrain.tileOverlays.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileOverlays[k]);
                                    }
                                    h = fnv1a32UpdateInt(h, 0x53484150); // 'SHAP'
                                    for (std::size_t k = 0; k < terrain.tileShapes.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileShapes[k]);
                                    }
                                    h = fnv1a32UpdateInt(h, 0x524f5441); // 'ROTA'
                                    for (std::size_t k = 0; k < terrain.tileRotations.size(); k++) {
                                        h = fnv1a32UpdateInt(h, terrain.tileRotations[k]);
                                    }

                                    h = fnv1a32UpdateInt(h, 0x4c4f4353); // 'LOCS'
                                    for (std::size_t pi = 0; pi < placements.size(); pi++) {
                                        const rs::LocPlacement& p = placements[pi];
                                        h = fnv1a32UpdateInt(h, p.id);
                                        h = fnv1a32UpdateInt(h, p.level);
                                        h = fnv1a32UpdateInt(h, p.localX);
                                        h = fnv1a32UpdateInt(h, p.localY);
                                        h = fnv1a32UpdateInt(h, p.type);
                                        h = fnv1a32UpdateInt(h, p.rotation);
                                    }

                                    h = fnv1a32UpdateInt(h, 0x4e504353); // 'NPCS'
                                    if (hasNpc) {
                                        for (std::size_t si = 0; si < spawns.size(); si++) {
                                            const rs::NpcSpawn& sp = spawns[si];
                                            h = fnv1a32UpdateInt(h, sp.id);
                                            h = fnv1a32UpdateInt(h, sp.x);
                                            h = fnv1a32UpdateInt(h, sp.y);
                                            h = fnv1a32UpdateInt(h, sp.level);
                                        }
                                    }

                                    std::cout << ", \"ok\": true, \"hash\": " << static_cast<rs::i32>(h)
                                              << ", \"locCount\": " << placements.size()
                                              << ", \"hasNpc\": " << (hasNpc ? "true" : "false")
                                              << ", \"npcCount\": " << (hasNpc ? spawns.size() : 0) << " }";
                                }
                            }
                        }
                    }
                }
            }
        }

        if (i + 1 < args.squares.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static rs::u32 hashUnderlayFloorType(const rs::UnderlayFloorType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x554e444c); // 'UNDL'
    h = fnv1a32UpdateInt(h, t.rgbColor);
    h = fnv1a32UpdateInt(h, t.hue);
    h = fnv1a32UpdateInt(h, t.saturation);
    h = fnv1a32UpdateInt(h, t.lightness);
    h = fnv1a32UpdateInt(h, t.hueMultiplier);
    h = fnv1a32UpdateInt(h, t.isOverlay ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.textureId);
    h = fnv1a32UpdateInt(h, t.textureSize);
    h = fnv1a32UpdateInt(h, t.blockShadow ? 1 : 0);
    return h;
}

static rs::u32 hashOverlayFloorType(const rs::OverlayFloorType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4f564552); // 'OVER'
    h = fnv1a32UpdateInt(h, t.primaryRgb);
    h = fnv1a32UpdateInt(h, t.textureId);
    h = fnv1a32UpdateInt(h, t.secondaryTextureId);
    h = fnv1a32UpdateInt(h, t.hideUnderlay ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.secondaryRgb);
    h = fnv1a32UpdateInt(h, t.blendRgb);
    h = fnv1a32UpdateInt(h, t.primaryHsl);
    h = fnv1a32UpdateInt(h, t.blendHsl);
    h = fnv1a32UpdateInt(h, t.occludes ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.hue);
    h = fnv1a32UpdateInt(h, t.saturation);
    h = fnv1a32UpdateInt(h, t.lightness);
    h = fnv1a32UpdateInt(h, t.hueBlend);
    h = fnv1a32UpdateInt(h, t.hueMultiplier);
    h = fnv1a32UpdateInt(h, t.secondaryHue);
    h = fnv1a32UpdateInt(h, t.secondarySaturation);
    h = fnv1a32UpdateInt(h, t.secondaryLightness);
    h = fnv1a32UpdateInt(h, t.textureSize);
    h = fnv1a32UpdateInt(h, t.blockShadow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.textureBrightness);
    h = fnv1a32UpdateInt(h, t.blendPriority);
    h = fnv1a32UpdateInt(h, t.blendable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.underwaterColor);
    h = fnv1a32UpdateInt(h, t.waterOpacity);
    h = fnv1a32UpdateInt(h, t.waterBias);
    h = fnv1a32UpdateInt(h, t.isOverlay ? 1 : 0);
    h = fnv1a32UpdateStrBytes(h, t.name);
    return h;
}

static rs::u32 hashVarBitType(const rs::VarBitType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x56425254); // 'VBRT'
    h = fnv1a32UpdateInt(h, t.baseVar);
    h = fnv1a32UpdateInt(h, t.startBit);
    h = fnv1a32UpdateInt(h, t.endBit);
    return h;
}

static rs::u32 hashEnumType(const rs::EnumType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x454e554d); // 'ENUM'
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.inputType));
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.outputType));
    h = fnv1a32UpdateStrBytes(h, t.defaultString);
    h = fnv1a32UpdateInt(h, t.defaultInt);
    h = fnv1a32UpdateInt(h, t.outputCount);

    // Keys + values (either intValues or stringValues).
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.keys.size()));
    for (std::size_t i = 0; i < t.keys.size(); i++) {
        h = fnv1a32UpdateInt(h, t.keys[i]);
    }

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.intValues.size()));
    for (std::size_t i = 0; i < t.intValues.size(); i++) {
        h = fnv1a32UpdateInt(h, t.intValues[i]);
    }

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.stringValues.size()));
    for (std::size_t i = 0; i < t.stringValues.size(); i++) {
        h = fnv1a32UpdateStrBytes(h, t.stringValues[i]);
    }

    return h;
}

static rs::u32 hashParamType(const rs::ParamType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x5041524d); // 'PARM'
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.type));
    h = fnv1a32UpdateInt(h, t.defaultInt);
    h = fnv1a32UpdateStrBytes(h, t.defaultString);
    h = fnv1a32UpdateInt(h, t.autoDisable ? 1 : 0);
    return h;
}

static rs::u32 hashLocType(const rs::LocType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4c4f4354); // 'LOCT'
    h = fnv1a32UpdateInt(h, t.lowDetail ? 1 : 0);
    h = fnv1a32UpdateStrBytes(h, t.name);
    h = fnv1a32UpdateInt(h, t.hasDesc ? 1 : 0);
    if (t.hasDesc) {
        h = fnv1a32UpdateStrBytes(h, t.desc);
    }

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.models.size()));
    for (std::size_t gi = 0; gi < t.models.size(); gi++) {
        const rs::Vec<rs::i32>& g = t.models[gi];
        h = fnv1a32UpdateInt(h, static_cast<rs::i32>(g.size()));
        for (std::size_t i = 0; i < g.size(); i++) {
            h = fnv1a32UpdateInt(h, g[i]);
        }
    }
    h = fnv1a32UpdateInt(h, t.hasTypes ? 1 : 0);
    if (t.hasTypes) {
        h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.types.size()));
        for (std::size_t i = 0; i < t.types.size(); i++) {
            h = fnv1a32UpdateInt(h, t.types[i]);
        }
    }

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.recolorFrom.size()));
    for (std::size_t i = 0; i < t.recolorFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.recolorFrom[i]);
        h = fnv1a32UpdateInt(h, t.recolorTo[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.retextureFrom.size()));
    for (std::size_t i = 0; i < t.retextureFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.retextureFrom[i]);
        h = fnv1a32UpdateInt(h, t.retextureTo[i]);
    }

    h = fnv1a32UpdateInt(h, t.sizeX);
    h = fnv1a32UpdateInt(h, t.sizeY);
    h = fnv1a32UpdateInt(h, t.clipType);
    h = fnv1a32UpdateInt(h, t.blocksProjectile ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isInteractive);
    h = fnv1a32UpdateInt(h, t.contouredGround);
    h = fnv1a32UpdateInt(h, t.contourGroundType);
    h = fnv1a32UpdateInt(h, t.contourGroundParam);
    h = fnv1a32UpdateInt(h, t.mergeNormals ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.modelClipped ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.seqId);
    h = fnv1a32UpdateInt(h, t.decorDisplacement);
    h = fnv1a32UpdateInt(h, t.ambient);
    h = fnv1a32UpdateInt(h, t.contrast);

    for (int i = 0; i < 5; i++) {
        h = fnv1a32UpdateInt(h, t.hasAction[i] ? 1 : 0);
        if (t.hasAction[i]) {
            h = fnv1a32UpdateStrBytes(h, t.actions[i]);
        }
    }

    h = fnv1a32UpdateInt(h, t.mapFunctionId);
    h = fnv1a32UpdateInt(h, t.mapSceneId);
    h = fnv1a32UpdateInt(h, t.flipMapSceneSprite ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.hardShadow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.membersOnly ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.rotateMapSceneSprite ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.mapSceneRotationOffset);
    h = fnv1a32UpdateInt(h, t.animated ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.cursor1Op);
    h = fnv1a32UpdateInt(h, t.cursor1);
    h = fnv1a32UpdateInt(h, t.cursor2Op);
    h = fnv1a32UpdateInt(h, t.cursor2);
    h = fnv1a32UpdateInt(h, t.occludeRoofs ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.forceDynamic ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isRotated ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.clipped ? 1 : 0);

    h = fnv1a32UpdateInt(h, t.modelSizeX);
    h = fnv1a32UpdateInt(h, t.modelSizeHeight);
    h = fnv1a32UpdateInt(h, t.modelSizeY);
    h = fnv1a32UpdateInt(h, t.offsetX);
    h = fnv1a32UpdateInt(h, t.offsetHeight);
    h = fnv1a32UpdateInt(h, t.offsetY);

    h = fnv1a32UpdateInt(h, t.obstructsGround ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isHollow ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.supportItems);

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.transforms.size()));
    for (std::size_t i = 0; i < t.transforms.size(); i++) {
        h = fnv1a32UpdateInt(h, t.transforms[i]);
    }
    h = fnv1a32UpdateInt(h, t.transformVarbit);
    h = fnv1a32UpdateInt(h, t.transformVarp);

    h = fnv1a32UpdateInt(h, t.ambientSoundId);
    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashNpcType(const rs::NpcType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4e504354); // 'NPCT'
    h = fnv1a32UpdateStrBytes(h, t.name);
    h = fnv1a32UpdateInt(h, t.size);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.modelIds.size()));
    for (std::size_t i = 0; i < t.modelIds.size(); i++) h = fnv1a32UpdateInt(h, t.modelIds[i]);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.chatheadModelIds.size()));
    for (std::size_t i = 0; i < t.chatheadModelIds.size(); i++) h = fnv1a32UpdateInt(h, t.chatheadModelIds[i]);
    h = fnv1a32UpdateInt(h, t.idleSeqId);
    h = fnv1a32UpdateInt(h, t.turnLeftSeqId);
    h = fnv1a32UpdateInt(h, t.turnRightSeqId);
    h = fnv1a32UpdateInt(h, t.walkSeqId);
    h = fnv1a32UpdateInt(h, t.walkBackSeqId);
    h = fnv1a32UpdateInt(h, t.walkLeftSeqId);
    h = fnv1a32UpdateInt(h, t.walkRightSeqId);

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.recolorFrom.size()));
    for (std::size_t i = 0; i < t.recolorFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.recolorFrom[i]);
        h = fnv1a32UpdateInt(h, t.recolorTo[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.retextureFrom.size()));
    for (std::size_t i = 0; i < t.retextureFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.retextureFrom[i]);
        h = fnv1a32UpdateInt(h, t.retextureTo[i]);
    }

    for (int i = 0; i < 5; i++) {
        h = fnv1a32UpdateInt(h, t.hasAction[i] ? 1 : 0);
        if (t.hasAction[i]) {
            h = fnv1a32UpdateStrBytes(h, t.actions[i]);
        }
    }

    h = fnv1a32UpdateInt(h, t.drawMapDot ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.combatLevel);
    h = fnv1a32UpdateInt(h, t.widthScale);
    h = fnv1a32UpdateInt(h, t.heightScale);
    h = fnv1a32UpdateInt(h, t.isVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.ambient);
    h = fnv1a32UpdateInt(h, t.contrast);
    h = fnv1a32UpdateInt(h, t.headIconPrayer);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.headIconSpriteIds.size()));
    for (std::size_t i = 0; i < t.headIconSpriteIds.size(); i++) h = fnv1a32UpdateInt(h, t.headIconSpriteIds[i]);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.headIconSpriteIndices.size()));
    for (std::size_t i = 0; i < t.headIconSpriteIndices.size(); i++) h = fnv1a32UpdateInt(h, t.headIconSpriteIndices[i]);
    h = fnv1a32UpdateInt(h, t.rotationSpeed);

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.transforms.size()));
    for (std::size_t i = 0; i < t.transforms.size(); i++) h = fnv1a32UpdateInt(h, t.transforms[i]);
    h = fnv1a32UpdateInt(h, t.transformVarbit);
    h = fnv1a32UpdateInt(h, t.transformVarp);

    h = fnv1a32UpdateInt(h, t.isInteractable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isClickable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.isFollower ? 1 : 0);

    h = fnv1a32UpdateInt(h, t.runSeqId);
    h = fnv1a32UpdateInt(h, t.runBackSeqId);
    h = fnv1a32UpdateInt(h, t.runLeftSeqId);
    h = fnv1a32UpdateInt(h, t.runRightSeqId);
    h = fnv1a32UpdateInt(h, t.crawlSeqId);
    h = fnv1a32UpdateInt(h, t.crawlBackSeqId);
    h = fnv1a32UpdateInt(h, t.crawlLeftSeqId);
    h = fnv1a32UpdateInt(h, t.crawlRightSeqId);

    h = fnv1a32UpdateInt(h, t.category);
    h = fnv1a32UpdateInt(h, t.loginScreenProps);
    h = fnv1a32UpdateInt(h, t.spawnDirection);
    h = fnv1a32UpdateInt(h, t.basTypeId);

    h = fnv1a32UpdateInt(h, t.readySoundId);
    h = fnv1a32UpdateInt(h, t.crawlSoundId);
    h = fnv1a32UpdateInt(h, t.walkSoundId);
    h = fnv1a32UpdateInt(h, t.runSoundId);
    h = fnv1a32UpdateInt(h, t.soundRangeMin);
    h = fnv1a32UpdateInt(h, t.soundRangeMax);
    h = fnv1a32UpdateInt(h, t.soundVolume);

    h = fnv1a32UpdateInt(h, t.cursor1Op);
    h = fnv1a32UpdateInt(h, t.cursor1);
    h = fnv1a32UpdateInt(h, t.cursor2Op);
    h = fnv1a32UpdateInt(h, t.cursor2);
    h = fnv1a32UpdateInt(h, t.attackCursor);
    h = fnv1a32UpdateInt(h, t.mapElementId);
    h = fnv1a32UpdateInt(h, t.mobilisingArmiesIcon);
    h = fnv1a32UpdateInt(h, t.timerbarSpriteId);
    h = fnv1a32UpdateInt(h, t.healthBarSpriteId);
    h = fnv1a32UpdateInt(h, t.lowPriority ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.colourHue);
    h = fnv1a32UpdateInt(h, t.colourSaturation);
    h = fnv1a32UpdateInt(h, t.colourLightness);
    h = fnv1a32UpdateInt(h, t.colourScale);
    h = fnv1a32UpdateInt(h, t.followerOpsPriorityFlag);

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.quests.size()));
    for (std::size_t i = 0; i < t.quests.size(); i++) h = fnv1a32UpdateInt(h, t.quests[i]);

    h = fnv1a32UpdateInt(h, t.vorbisSound ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.soundRateMin);
    h = fnv1a32UpdateInt(h, t.soundRateMax);
    h = fnv1a32UpdateInt(h, t.pickSizeShift);

    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashObjType(const rs::ObjType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4f424a54); // 'OBJT'
    h = fnv1a32UpdateInt(h, t.model);
    h = fnv1a32UpdateStrBytes(h, t.name);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.recolorFrom.size()));
    for (std::size_t i = 0; i < t.recolorFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.recolorFrom[i]);
        h = fnv1a32UpdateInt(h, t.recolorTo[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.retextureFrom.size()));
    for (std::size_t i = 0; i < t.retextureFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.retextureFrom[i]);
        h = fnv1a32UpdateInt(h, t.retextureTo[i]);
    }
    h = fnv1a32UpdateInt(h, t.zoom2d);
    h = fnv1a32UpdateInt(h, t.xan2d);
    h = fnv1a32UpdateInt(h, t.yan2d);
    h = fnv1a32UpdateInt(h, t.zan2d);
    h = fnv1a32UpdateInt(h, t.offsetX2d);
    h = fnv1a32UpdateInt(h, t.offsetY2d);
    h = fnv1a32UpdateStrBytes(h, t.op9);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.stackability));
    h = fnv1a32UpdateInt(h, t.price);
    h = fnv1a32UpdateInt(h, t.op13);
    h = fnv1a32UpdateInt(h, t.op14);
    h = fnv1a32UpdateInt(h, t.isMembers ? 1 : 0);

    for (int i = 0; i < 5; i++) {
        h = fnv1a32UpdateInt(h, t.hasGroundAction[i] ? 1 : 0);
        if (t.hasGroundAction[i]) {
            h = fnv1a32UpdateStrBytes(h, t.groundActions[i]);
        }
    }
    for (int i = 0; i < 5; i++) {
        h = fnv1a32UpdateInt(h, t.hasInventoryAction[i] ? 1 : 0);
        if (t.hasInventoryAction[i]) {
            h = fnv1a32UpdateStrBytes(h, t.inventoryActions[i]);
        }
    }
    h = fnv1a32UpdateInt(h, t.shiftClickIndex);

    h = fnv1a32UpdateInt(h, t.maleModel);
    h = fnv1a32UpdateInt(h, t.maleModel1);
    h = fnv1a32UpdateInt(h, t.maleOffset);
    h = fnv1a32UpdateInt(h, t.femaleModel);
    h = fnv1a32UpdateInt(h, t.femaleModel1);
    h = fnv1a32UpdateInt(h, t.femaleOffset);
    h = fnv1a32UpdateInt(h, t.maleModel2);
    h = fnv1a32UpdateInt(h, t.femaleModel2);

    h = fnv1a32UpdateInt(h, t.maleHeadModel);
    h = fnv1a32UpdateInt(h, t.maleHeadModel2);
    h = fnv1a32UpdateInt(h, t.femaleHeadModel);
    h = fnv1a32UpdateInt(h, t.femaleHeadModel2);

    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.countObj.size()));
    for (std::size_t i = 0; i < t.countObj.size(); i++) {
        h = fnv1a32UpdateInt(h, t.countObj[i]);
        h = fnv1a32UpdateInt(h, t.countCo[i]);
    }

    h = fnv1a32UpdateInt(h, t.op27);
    h = fnv1a32UpdateInt(h, t.note);
    h = fnv1a32UpdateInt(h, t.noteTemplate);
    h = fnv1a32UpdateInt(h, t.resizeX);
    h = fnv1a32UpdateInt(h, t.resizeY);
    h = fnv1a32UpdateInt(h, t.resizeZ);
    h = fnv1a32UpdateInt(h, t.ambient);
    h = fnv1a32UpdateInt(h, t.contrast);
    h = fnv1a32UpdateInt(h, t.team);
    h = fnv1a32UpdateInt(h, t.isTradable ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.op75);
    h = fnv1a32UpdateInt(h, t.unnotedId);
    h = fnv1a32UpdateInt(h, t.notedId);
    h = fnv1a32UpdateInt(h, t.placeholder);
    h = fnv1a32UpdateInt(h, t.placeholderTemplate);

    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashSeqType(const rs::SeqType& t) {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x53455154); // 'SEQT'
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.frameIds.size()));
    for (std::size_t i = 0; i < t.frameIds.size(); i++) {
        h = fnv1a32UpdateInt(h, t.frameIds[i]);
        h = fnv1a32UpdateInt(h, t.frameLengths[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.chatFrameIds.size()));
    for (std::size_t i = 0; i < t.chatFrameIds.size(); i++) {
        h = fnv1a32UpdateInt(h, t.chatFrameIds[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.masks.size()));
    for (std::size_t i = 0; i < t.masks.size(); i++) {
        h = fnv1a32UpdateInt(h, t.masks[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.frameSounds.size()));
    for (std::size_t i = 0; i < t.frameSounds.size(); i++) {
        const rs::SeqSoundEffect& e = t.frameSounds[i];
        h = fnv1a32UpdateInt(h, e.id);
        h = fnv1a32UpdateInt(h, e.loops);
        h = fnv1a32UpdateInt(h, e.location);
        h = fnv1a32UpdateInt(h, e.retain);
    }

    h = fnv1a32UpdateInt(h, t.frameStep);
    h = fnv1a32UpdateInt(h, t.stretches ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.forcedPriority);
    h = fnv1a32UpdateInt(h, t.leftHandItem);
    h = fnv1a32UpdateInt(h, t.rightHandItem);
    h = fnv1a32UpdateInt(h, t.maxLoops);
    h = fnv1a32UpdateInt(h, t.looping ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.precedenceAnimating);
    h = fnv1a32UpdateInt(h, t.priority);
    h = fnv1a32UpdateInt(h, t.replayMode);
    h = fnv1a32UpdateInt(h, t.tweened ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.vorbisSound ? 1 : 0);

    // Sound tuning: hash sorted by index for stability.
    std::vector<std::pair<int, int>> vols;
    vols.reserve(t.soundVolumesByIndex.size());
    for (std::size_t i = 0; i < t.soundVolumesByIndex.size(); i++) {
        vols.emplace_back(static_cast<int>(t.soundVolumesByIndex[i].index), static_cast<int>(t.soundVolumesByIndex[i].volume));
    }
    std::sort(vols.begin(), vols.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(vols.size()));
    for (const auto& v : vols) {
        h = fnv1a32UpdateInt(h, v.first);
        h = fnv1a32UpdateInt(h, v.second);
    }

    struct Rate final { int index = 0; int rateMin = 0; int rateMax = 0; };
    std::vector<Rate> rates;
    rates.reserve(t.soundRatesByIndex.size());
    for (std::size_t i = 0; i < t.soundRatesByIndex.size(); i++) {
        Rate r{};
        r.index = static_cast<int>(t.soundRatesByIndex[i].index);
        r.rateMin = static_cast<int>(t.soundRatesByIndex[i].rateMin);
        r.rateMax = static_cast<int>(t.soundRatesByIndex[i].rateMax);
        rates.push_back(r);
    }
    std::sort(rates.begin(), rates.end(), [](const auto& a, const auto& b) { return a.index < b.index; });
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(rates.size()));
    for (const auto& r : rates) {
        h = fnv1a32UpdateInt(h, r.index);
        h = fnv1a32UpdateInt(h, r.rateMin);
        h = fnv1a32UpdateInt(h, r.rateMax);
    }

    h = fnv1a32UpdateInt(h, t.animMayaId);
    h = fnv1a32UpdateInt(h, t.animMayaStart);
    h = fnv1a32UpdateInt(h, t.animMayaEnd);
    h = fnv1a32UpdateInt(h, t.hasAnimMayaMasks ? 1 : 0);
    if (t.hasAnimMayaMasks) {
        for (int i = 0; i < 256; i++) {
            h = fnv1a32UpdateInt(h, t.animMayaMasks[i] ? 1 : 0);
        }
    }

    struct MayaSound final { int frame = 0; int id = 0; int loops = 0; int location = 0; int retain = 0; };
    std::vector<MayaSound> mayaSounds;
    mayaSounds.reserve(t.animMayaFrameSounds.size());
    for (std::size_t i = 0; i < t.animMayaFrameSounds.size(); i++) {
        const rs::SeqMayaFrameSound& ms = t.animMayaFrameSounds[i];
        MayaSound out{};
        out.frame = static_cast<int>(ms.frame);
        out.id = static_cast<int>(ms.effect.id);
        out.loops = static_cast<int>(ms.effect.loops);
        out.location = static_cast<int>(ms.effect.location);
        out.retain = static_cast<int>(ms.effect.retain);
        mayaSounds.push_back(out);
    }
    std::sort(mayaSounds.begin(), mayaSounds.end(), [](const auto& a, const auto& b) { return a.frame < b.frame; });
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(mayaSounds.size()));
    for (const auto& ms : mayaSounds) {
        h = fnv1a32UpdateInt(h, ms.frame);
        h = fnv1a32UpdateInt(h, ms.id);
        h = fnv1a32UpdateInt(h, ms.loops);
        h = fnv1a32UpdateInt(h, ms.location);
        h = fnv1a32UpdateInt(h, ms.retain);
    }

    h = fnv1a32UpdateInt(h, t.rotateNormals ? 1 : 0);
    return h;
}

static rs::u32 hashSpotAnimType(const rs::SpotAnimType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x5350414e); // 'SPAN'
    h = fnv1a32UpdateInt(h, t.modelId);
    h = fnv1a32UpdateInt(h, t.sequenceId);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.recolorFrom.size()));
    for (std::size_t i = 0; i < t.recolorFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.recolorFrom[i]);
        h = fnv1a32UpdateInt(h, t.recolorTo[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.retextureFrom.size()));
    for (std::size_t i = 0; i < t.retextureFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.retextureFrom[i]);
        h = fnv1a32UpdateInt(h, t.retextureTo[i]);
    }
    h = fnv1a32UpdateInt(h, t.widthScale);
    h = fnv1a32UpdateInt(h, t.heightScale);
    h = fnv1a32UpdateInt(h, t.orientation);
    h = fnv1a32UpdateInt(h, t.ambient);
    h = fnv1a32UpdateInt(h, t.contrast);
    return h;
}

static rs::u32 hashBasType(const rs::BasType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x42415354); // 'BAST'
    h = fnv1a32UpdateInt(h, t.idleSeqId);
    h = fnv1a32UpdateInt(h, t.walkSeqId);
    for (int i = 0; i < 12; i++) {
        h = fnv1a32UpdateInt(h, t.hasModelRotateTranslate[i] ? 1 : 0);
        if (t.hasModelRotateTranslate[i]) {
            for (int k = 0; k < 6; k++) {
                h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.modelRotateTranslate[i][k]));
            }
        }
    }
    return h;
}

static rs::u32 hashIdkType(const rs::IdkType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x49444b54); // 'IDKT'
    h = fnv1a32UpdateInt(h, t.bodyPartId);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.modelIds.size()));
    for (std::size_t i = 0; i < t.modelIds.size(); i++) h = fnv1a32UpdateInt(h, t.modelIds[i]);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.recolorFrom.size()));
    for (std::size_t i = 0; i < t.recolorFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.recolorFrom[i]);
        h = fnv1a32UpdateInt(h, t.recolorTo[i]);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.retextureFrom.size()));
    for (std::size_t i = 0; i < t.retextureFrom.size(); i++) {
        h = fnv1a32UpdateInt(h, t.retextureFrom[i]);
        h = fnv1a32UpdateInt(h, t.retextureTo[i]);
    }
    h = fnv1a32UpdateInt(h, 5);
    for (int i = 0; i < 5; i++) h = fnv1a32UpdateInt(h, t.ifModelIds[i]);
    h = fnv1a32UpdateInt(h, t.nonSelectable ? 1 : 0);
    return h;
}

static rs::u32 hashInvType(const rs::InvType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x494e5654); // 'INVT'
    h = fnv1a32UpdateInt(h, t.itemCount);
    return h;
}

static rs::u32 hashMapSceneType(const rs::MapSceneType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4d53434e); // 'MSCN'
    h = fnv1a32UpdateInt(h, t.spriteId);
    h = fnv1a32UpdateInt(h, t.colorRgb);
    h = fnv1a32UpdateInt(h, t.enlarge ? 1 : 0);
    return h;
}

static rs::u32 hashMapElementType(const rs::MapElementType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4d454c54); // 'MELT'
    h = fnv1a32UpdateInt(h, t.spriteId);
    h = fnv1a32UpdateInt(h, t.hoverSpriteId);
    const rs::Str empty{};
    h = fnv1a32UpdateStrBytes(h, t.hasName ? t.name : empty);
    h = fnv1a32UpdateInt(h, t.textColor);
    h = fnv1a32UpdateInt(h, t.hoverTextColor);
    h = fnv1a32UpdateInt(h, t.textSize);
    h = fnv1a32UpdateInt(h, t.worldMapVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.minimapVisible ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.randomizePosition ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.showInElementList ? 1 : 0);
    h = fnv1a32UpdateInt(h, 5);
    for (int i = 0; i < 5; i++) {
        h = fnv1a32UpdateInt(h, t.hasOp[i] ? 1 : 0);
        if (t.hasOp[i]) h = fnv1a32UpdateStrBytes(h, t.ops[i]);
    }
    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashStructType(const rs::StructType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x53545254); // 'STRT'
    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashQuestType(const rs::QuestType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x51554553); // 'QUES'
    const rs::Str empty{};
    h = fnv1a32UpdateStrBytes(h, t.hasName ? t.name : empty);
    h = fnv1a32UpdateStrBytes(h, t.hasSortName ? t.sortName : empty);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.varps.size()));
    for (std::size_t i = 0; i < t.varps.size(); i++) {
        const rs::QuestVar& v = t.varps[i];
        h = fnv1a32UpdateInt(h, v.id);
        h = fnv1a32UpdateInt(h, v.inProgressValue);
        h = fnv1a32UpdateInt(h, v.completedValue);
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.varbits.size()));
    for (std::size_t i = 0; i < t.varbits.size(); i++) {
        const rs::QuestVar& v = t.varbits[i];
        h = fnv1a32UpdateInt(h, v.id);
        h = fnv1a32UpdateInt(h, v.inProgressValue);
        h = fnv1a32UpdateInt(h, v.completedValue);
    }
    h = fnv1a32UpdateInt(h, t.type);
    h = fnv1a32UpdateInt(h, t.difficulty);
    h = fnv1a32UpdateInt(h, t.member ? 1 : 0);
    h = fnv1a32UpdateInt(h, t.points);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.questRequirements.size()));
    for (std::size_t i = 0; i < t.questRequirements.size(); i++) h = fnv1a32UpdateInt(h, t.questRequirements[i]);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(t.skillRequirements.size()));
    for (std::size_t i = 0; i < t.skillRequirements.size(); i++) {
        const rs::QuestSkillReq& r = t.skillRequirements[i];
        h = fnv1a32UpdateInt(h, r.id);
        h = fnv1a32UpdateInt(h, r.level);
    }
    h = fnv1a32UpdateInt(h, t.pointsRequirement);
    h = fnv1a32UpdateParams(h, t.params);
    return h;
}

static rs::u32 hashVarPlayerType(const rs::VarPlayerType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x56504c59); // 'VPLY'
    h = fnv1a32UpdateInt(h, t.type);
    return h;
}

static rs::u32 hashVarClientIntType(const rs::VarClientIntType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x56434949); // 'VCII'
    h = fnv1a32UpdateInt(h, t.persist ? 1 : 0);
    return h;
}

static rs::u32 hashVarClientStrType(const rs::VarClientStrType& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x56434953); // 'VCIS'
    h = fnv1a32UpdateInt(h, t.persist ? 1 : 0);
    return h;
}

static rs::u32 hashGraphicsDefaults(const rs::GraphicsDefaults& t) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x47524658); // 'GRFX'
    h = fnv1a32UpdateInt(h, t.compass);
    h = fnv1a32UpdateInt(h, t.mapEdge);
    h = fnv1a32UpdateInt(h, t.mapScenes);
    h = fnv1a32UpdateInt(h, t.mapFunctions);
    h = fnv1a32UpdateInt(h, t.headIconsPk);
    h = fnv1a32UpdateInt(h, t.headIconsPrayer);
    h = fnv1a32UpdateInt(h, t.headIconsHint);
    h = fnv1a32UpdateInt(h, t.mapMarkers);
    h = fnv1a32UpdateInt(h, t.crosses);
    h = fnv1a32UpdateInt(h, t.mapDots);
    h = fnv1a32UpdateInt(h, t.scrollBars);
    h = fnv1a32UpdateInt(h, t.modIcons);
    return h;
}

template <typename T>
static rs::u32 fnv1a32UpdateVec(rs::u32 h, const rs::Vec<T>& v) noexcept {
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(v.size()));
    for (std::size_t i = 0; i < v.size(); i++) {
        h = fnv1a32UpdateInt(h, static_cast<rs::i32>(v[i]));
    }
    return h;
}

template <typename T>
static rs::u32 fnv1a32UpdateOptionalVec(rs::u32 h, bool present, const rs::Vec<T>& v) noexcept {
    h = fnv1a32UpdateInt(h, present ? 1 : 0);
    if (present) {
        h = fnv1a32UpdateVec(h, v);
    }
    return h;
}

static rs::u32 fnv1a32UpdateNestedVec(rs::u32 h, bool present, const rs::Vec<rs::Vec<rs::i32>>& v) noexcept {
    h = fnv1a32UpdateInt(h, present ? 1 : 0);
    if (!present) {
        return h;
    }
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(v.size()));
    for (std::size_t i = 0; i < v.size(); i++) {
        h = fnv1a32UpdateVec(h, v[i]);
    }
    return h;
}

static rs::u32 hashModelData(const rs::ModelData& m) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x4d444154); // 'MDAT'
    h = fnv1a32UpdateInt(h, m.version);
    h = fnv1a32UpdateInt(h, m.verticesCount);
    h = fnv1a32UpdateInt(h, m.usedVertexCount);
    h = fnv1a32UpdateInt(h, m.faceCount);
    h = fnv1a32UpdateInt(h, m.textureFaceCount);
    h = fnv1a32UpdateInt(h, m.priority);
    h = fnv1a32UpdateVec(h, m.verticesX);
    h = fnv1a32UpdateVec(h, m.verticesY);
    h = fnv1a32UpdateVec(h, m.verticesZ);
    h = fnv1a32UpdateVec(h, m.indices1);
    h = fnv1a32UpdateVec(h, m.indices2);
    h = fnv1a32UpdateVec(h, m.indices3);
    h = fnv1a32UpdateVec(h, m.faceColors);
    h = fnv1a32UpdateOptionalVec(h, m.hasFaceRenderTypes, m.faceRenderTypes);
    h = fnv1a32UpdateOptionalVec(h, m.hasFaceRenderPriorities, m.faceRenderPriorities);
    h = fnv1a32UpdateOptionalVec(h, m.hasFaceAlphas, m.faceAlphas);
    h = fnv1a32UpdateOptionalVec(h, m.hasTextureCoords, m.textureCoords);
    h = fnv1a32UpdateOptionalVec(h, m.hasFaceTextures, m.faceTextures);
    h = fnv1a32UpdateVec(h, m.textureRenderTypes);
    h = fnv1a32UpdateVec(h, m.textureMappingP);
    h = fnv1a32UpdateVec(h, m.textureMappingM);
    h = fnv1a32UpdateVec(h, m.textureMappingN);
    h = fnv1a32UpdateVec(h, m.textureScaleX);
    h = fnv1a32UpdateVec(h, m.textureScaleY);
    h = fnv1a32UpdateVec(h, m.textureScaleZ);
    h = fnv1a32UpdateVec(h, m.textureRotation);
    h = fnv1a32UpdateVec(h, m.textureDirection);
    h = fnv1a32UpdateVec(h, m.textureSpeed);
    h = fnv1a32UpdateVec(h, m.textureTransU);
    h = fnv1a32UpdateVec(h, m.textureTransV);
    h = fnv1a32UpdateOptionalVec(h, m.hasVertexSkins, m.vertexSkins);
    h = fnv1a32UpdateOptionalVec(h, m.hasFaceSkins, m.faceSkins);
    h = fnv1a32UpdateNestedVec(h, m.hasMayaGroups, m.animMayaGroups);
    h = fnv1a32UpdateNestedVec(h, m.hasMayaGroups, m.animMayaScales);
    return h;
}

static rs::u32 hashSeqFrame(const rs::SeqFrame& f) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x53514652); // 'SQFR'
    h = fnv1a32UpdateInt(h, f.frameLength);
    h = fnv1a32UpdateInt(h, f.baseId);
    h = fnv1a32UpdateInt(h, f.transformCount);
    h = fnv1a32UpdateInt(h, f.hasAlphaTransform ? 1 : 0);
    h = fnv1a32UpdateInt(h, f.hasColorTransform ? 1 : 0);
    h = fnv1a32UpdateVec(h, f.transformGroups);
    h = fnv1a32UpdateVec(h, f.transformX);
    h = fnv1a32UpdateVec(h, f.transformY);
    h = fnv1a32UpdateVec(h, f.transformZ);
    h = fnv1a32UpdateVec(h, f.resetOriginGroups);
    return h;
}

static rs::u32 hashSkeletalSeq(const rs::SkeletalSeq& s) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x534b454c); // 'SKEL'
    h = fnv1a32UpdateInt(h, s.id);
    h = fnv1a32UpdateInt(h, s.version);
    h = fnv1a32UpdateInt(h, s.baseId);
    h = fnv1a32UpdateInt(h, s.poseId);
    h = fnv1a32UpdateInt(h, s.curveCount);
    h = fnv1a32UpdateInt(h, s.hasAlphaTransform ? 1 : 0);
    return h;
}

static rs::u32 fnv1a32UpdateFloat(rs::u32 h, float v) noexcept {
    rs::u32 bits = 0;
    static_assert(sizeof(float) == sizeof(rs::u32), "float size mismatch");
    std::memcpy(&bits, &v, sizeof(bits));
    h ^= (bits) & 0xFFu;
    h *= 16777619u;
    h ^= (bits >> 8) & 0xFFu;
    h *= 16777619u;
    h ^= (bits >> 16) & 0xFFu;
    h *= 16777619u;
    h ^= (bits >> 24) & 0xFFu;
    h *= 16777619u;
    return h;
}

static rs::u32 hashSkeletalFinalMatrices(const rs::Span<const rs::Mat4f> mats) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x534b464d); // 'SKFM'
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(mats.size()));
    for (std::size_t i = 0; i < mats.size(); i++) {
        for (int e = 0; e < 16; e++) {
            h = fnv1a32UpdateFloat(h, mats[i].v[e]);
        }
    }
    return h;
}

static rs::u32 hashModelVertices(const rs::ModelData& m) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x534b4d44); // 'SKMD'
    h = fnv1a32UpdateInt(h, m.verticesCount);
    for (std::size_t i = 0; i < m.verticesX.size(); i++) {
        h = fnv1a32UpdateInt(h, m.verticesX[i]);
    }
    for (std::size_t i = 0; i < m.verticesY.size(); i++) {
        h = fnv1a32UpdateInt(h, m.verticesY[i]);
    }
    for (std::size_t i = 0; i < m.verticesZ.size(); i++) {
        h = fnv1a32UpdateInt(h, m.verticesZ[i]);
    }
    return h;
}

static rs::u32 hashModelFaceAlphas(const rs::ModelData& m) noexcept {
    rs::u32 h = 2166136261u;
    h = fnv1a32UpdateInt(h, 0x534b4d41); // 'SKMA'
    const bool has = m.hasFaceAlphas && !m.faceAlphas.empty();
    h = fnv1a32UpdateInt(h, has ? 1 : 0);
    h = fnv1a32UpdateInt(h, static_cast<rs::i32>(m.faceAlphas.size()));
    for (std::size_t i = 0; i < m.faceAlphas.size(); i++) {
        const rs::i32 a = static_cast<unsigned char>(m.faceAlphas[i]);
        h = fnv1a32UpdateInt(h, a);
    }
    return h;
}

static int cmdModelHashes(int argc, char** argv) {
    const ModelHashArgs args = parseModelHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];
        std::cout << "    { \"id\": " << id;

        rs::ModelData model(alloc);
        const rs::Status st = session.tryLoadModel(static_cast<rs::i32>(id), &model);
        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            const rs::u32 hash = hashModelData(model);
            std::cout << ", \"ok\": true, \"hash\": " << static_cast<rs::i32>(hash) << " }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSeqFrameHashes(int argc, char** argv) {
    const SeqFrameHashArgs args = parseSeqFrameHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"hasSeqFrameService\": " << (session.hasSeqFrameService() ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];
        std::cout << "    { \"id\": " << id;

        rs::SeqFrame frame(alloc);
        const rs::Status st = session.tryLoadSeqFrame(static_cast<rs::i32>(id), &frame);
        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            const rs::u32 hash = hashSeqFrame(frame);
            std::cout << ", \"ok\": true, \"hash\": " << static_cast<rs::i32>(hash) << " }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSkeletalSeqHashes(int argc, char** argv) {
    const SkeletalSeqHashArgs args = parseSkeletalSeqHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"hasSkeletalSeqLoader\": " << (session.hasSkeletalSeqLoader() ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];
        std::cout << "    { \"id\": " << id;

        rs::SkeletalSeq seq{};
        const rs::Status st = session.tryLoadSkeletalSeq(static_cast<rs::i32>(id), &seq);
        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            const rs::u32 hash = hashSkeletalSeq(seq);
            std::cout << ", \"ok\": true";
            std::cout << ", \"hash\": " << static_cast<rs::i32>(hash);
            std::cout << ", \"version\": " << seq.version;
            std::cout << ", \"baseId\": " << seq.baseId;
            std::cout << ", \"poseId\": " << seq.poseId;
            std::cout << ", \"curveCount\": " << seq.curveCount;
            std::cout << ", \"hasAlphaTransform\": " << (seq.hasAlphaTransform ? "true" : "false");
            std::cout << " }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSkeletalEvalHashes(int argc, char** argv) {
    const SkeletalEvalHashArgs args = parseSkeletalEvalHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.maxFrames <= 0) {
        throw std::runtime_error("Invalid --maxFrames");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }
    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }
    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"maxFrames\": " << args.maxFrames << ",\n";
    std::cout << "  \"hasSkeletalSeqLoader\": " << (session.hasSkeletalSeqLoader() ? "true" : "false") << ",\n";
    std::cout << "  \"hasSeqBaseService\": " << (session.hasSeqBaseService() ? "true" : "false") << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const rs::i32 id = static_cast<rs::i32>(args.ids[i]);
        std::cout << "    { \"id\": " << id;

        rs::SkeletalSeq seq{};
        rs::Status st = session.tryLoadSkeletalSeq(id, &seq);
        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            const rs::i32 sampleCount = static_cast<rs::i32>(args.maxFrames);
            std::cout << ", \"ok\": true";
            std::cout << ", \"baseId\": " << seq.baseId;
            std::cout << ", \"poseId\": " << seq.poseId;
            std::cout << ", \"curveCount\": " << seq.curveCount;
            std::cout << ", \"frameCount\": " << sampleCount;
            std::cout << ", \"samples\": [";
            for (rs::i32 si = 0; si < sampleCount; si++) {
                const rs::i32 frame = si;
                rs::Vec<rs::Mat4f> finalMatrices(alloc);
                const rs::Status es = session.tryComputeSkeletalFinalMatrices(id, frame, &finalMatrices, alloc);
                if (si > 0) std::cout << ", ";
                std::cout << "{ \"frame\": " << frame;
                if (!rs::ok(es)) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string(statusName(es)));
                    std::cout << ", \"errorClass\": ";
                    writeJsonEscaped(std::cout, std::string(statusErrorClass(es)));
                } else {
                    const rs::u32 hash = hashSkeletalFinalMatrices(rs::Span<const rs::Mat4f>(finalMatrices.data(), finalMatrices.size()));
                    std::cout << ", \"ok\": true";
                    std::cout << ", \"boneCount\": " << finalMatrices.size();
                    std::cout << ", \"hash\": " << static_cast<rs::i32>(hash);
                }
                std::cout << " }";
            }
            std::cout << "] }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSkeletalEvalBench(int argc, char** argv) {
    const SkeletalEvalBenchArgs args = parseSkeletalEvalBenchArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.maxFrames <= 0) {
        throw std::runtime_error("Invalid --maxFrames");
    }
    if (args.iterations <= 0) {
        throw std::runtime_error("Invalid --iterations");
    }
    if (args.warmup < 0) {
        throw std::runtime_error("Invalid --warmup");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }
    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }
    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    rs::i64 totalSamples = 0;
    rs::i64 okSamples = 0;
    rs::i64 errorSamples = 0;
    rs::i64 totalBoneMatrices = 0;
    std::unordered_map<int, rs::i64> errorStatusCounts;

    auto runPasses = [&](int passes, bool collectStats) {
        for (int it = 0; it < passes; it++) {
            for (std::size_t i = 0; i < args.ids.size(); i++) {
                const rs::i32 id = static_cast<rs::i32>(args.ids[i]);
                for (rs::i32 frame = 0; frame < static_cast<rs::i32>(args.maxFrames); frame++) {
                    rs::Vec<rs::Mat4f> finalMatrices(alloc);
                    const rs::Status s = session.tryComputeSkeletalFinalMatrices(id, frame, &finalMatrices, alloc);
                    if (!collectStats) continue;
                    totalSamples++;
                    if (rs::ok(s)) {
                        okSamples++;
                        totalBoneMatrices += static_cast<rs::i64>(finalMatrices.size());
                    } else {
                        errorSamples++;
                        errorStatusCounts[static_cast<int>(s)] += 1;
                    }
                }
            }
        }
    };

    if (args.warmup > 0) {
        runPasses(args.warmup, false);
    }

    const auto t0 = std::chrono::steady_clock::now();
    runPasses(args.iterations, true);
    const auto t1 = std::chrono::steady_clock::now();
    const auto elapsedNs =
        std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
    const double elapsedMs = static_cast<double>(elapsedNs) / 1.0e6;
    const double nsPerSample = (totalSamples > 0) ? static_cast<double>(elapsedNs) / static_cast<double>(totalSamples) : 0.0;
    const double nsPerBone = (totalBoneMatrices > 0) ? static_cast<double>(elapsedNs) / static_cast<double>(totalBoneMatrices) : 0.0;

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"ids\": " << args.ids.size() << ",\n";
    std::cout << "  \"maxFrames\": " << args.maxFrames << ",\n";
    std::cout << "  \"iterations\": " << args.iterations << ",\n";
    std::cout << "  \"warmup\": " << args.warmup << ",\n";
    std::cout << "  \"samples\": " << totalSamples << ",\n";
    std::cout << "  \"okSamples\": " << okSamples << ",\n";
    std::cout << "  \"errorSamples\": " << errorSamples << ",\n";
    std::cout << "  \"totalBoneMatrices\": " << totalBoneMatrices << ",\n";
    std::cout << "  \"elapsedMs\": " << elapsedMs << ",\n";
    std::cout << "  \"nsPerSample\": " << nsPerSample << ",\n";
    std::cout << "  \"nsPerBoneMatrix\": " << nsPerBone << ",\n";
    std::cout << "  \"errorStatusCounts\": {";
    bool first = true;
    for (const auto& kv : errorStatusCounts) {
        if (!first) std::cout << ", ";
        first = false;
        writeJsonEscaped(std::cout, std::string(statusName(static_cast<rs::Status>(kv.first))));
        std::cout << ": " << kv.second;
    }
    std::cout << " }\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSkeletalModelHashes(int argc, char** argv) {
    const SkeletalModelHashArgs args = parseSkeletalModelHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.pairs.empty()) {
        throw std::runtime_error("Missing --pairs <seqId:modelId,...>");
    }
    if (args.frame < 0) {
        throw std::runtime_error("Invalid --frame");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }
    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }
    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"frame\": " << args.frame << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.pairs.size(); i++) {
        const rs::i32 seqId = static_cast<rs::i32>(args.pairs[i].first);
        const rs::i32 modelId = static_cast<rs::i32>(args.pairs[i].second);
        std::cout << "    { \"seqId\": " << seqId << ", \"modelId\": " << modelId;

        rs::SkeletalSeq seq{};
        rs::Status st = session.tryLoadSkeletalSeq(seqId, &seq);
        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            rs::ModelData model(alloc);
            st = session.tryLoadModel(modelId, &model);
            if (!rs::ok(st)) {
                std::cout << ", \"ok\": false, \"status\": ";
                writeJsonEscaped(std::cout, std::string(statusName(st)));
                std::cout << ", \"errorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
                std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
            } else {
                const rs::i32 evalFrame = static_cast<rs::i32>(args.frame);
                const rs::Status as = session.tryApplySkeletalSeqToModel(seqId, evalFrame, &model, alloc);
                if (!rs::ok(as)) {
                    std::cout << ", \"ok\": false, \"status\": ";
                    writeJsonEscaped(std::cout, std::string(statusName(as)));
                    std::cout << ", \"errorClass\": ";
                    writeJsonEscaped(std::cout, std::string(statusErrorClass(as)));
                    std::cout << ", \"statusCode\": " << static_cast<int>(as) << " }";
                } else {
                    const rs::u32 hash = hashModelVertices(model);
                    const rs::u32 alphaHash = hashModelFaceAlphas(model);
                    std::cout << ", \"ok\": true";
                    std::cout << ", \"baseId\": " << seq.baseId;
                    std::cout << ", \"poseId\": " << seq.poseId;
                    std::cout << ", \"curveCount\": " << seq.curveCount;
                    std::cout << ", \"vertexCount\": " << model.verticesCount;
                    std::cout << ", \"hash\": " << static_cast<rs::i32>(hash);
                    std::cout << ", \"hasFaceAlphas\": " << (model.hasFaceAlphas ? "true" : "false");
                    std::cout << ", \"alphaHash\": " << static_cast<rs::i32>(alphaHash);
                    std::cout << " }";
                }
            }
        }

        if (i + 1 < args.pairs.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSeqTypeFrameLengths(int argc, char** argv) {
    const SeqTypeFrameLengthsArgs args = parseSeqTypeFrameLengthsArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.maxFrames <= 0) {
        throw std::runtime_error("Invalid --maxFrames");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"maxFrames\": " << args.maxFrames << ",\n";
    std::cout << "  \"entries\": [\n";

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];
        std::cout << "    { \"id\": " << id;

        const rs::SeqType* seq = nullptr;
        rs::Status st = session.tryGetSeqType(static_cast<rs::i32>(id), &seq);
        if (!rs::ok(st) || !seq) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            const std::size_t totalFrames = seq->frameLengths.size();
            const std::size_t takeFrames = std::min<std::size_t>(totalFrames, static_cast<std::size_t>(args.maxFrames));
            std::cout << ", \"ok\": true, \"frameCount\": " << totalFrames << ", \"lengths\": [";
            for (std::size_t fi = 0; fi < takeFrames; fi++) {
                rs::i32 frameLength = 0;
                rs::Status ls = session.tryGetSeqTypeFrameLength(*seq, static_cast<rs::i32>(fi), &frameLength);
                if (!rs::ok(ls) && fi < seq->frameLengths.size()) {
                    frameLength = seq->frameLengths[fi];
                }
                if (fi > 0) std::cout << ", ";
                std::cout << frameLength;
            }
            std::cout << "] }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdAnimSelectionSnapshot(int argc, char** argv) {
    const AnimSelectionSnapshotArgs args = parseAnimSelectionSnapshotArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.maxFrames <= 0) {
        throw std::runtime_error("Invalid --maxFrames");
    }
    if (args.npcIds.empty() && args.locIds.empty()) {
        throw std::runtime_error("Missing --npcIds and/or --locIds");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    auto writeSeqResolution = [&](rs::i32 seqId) {
        std::cout << "{ \"seqId\": " << seqId;
        if (seqId < 0) {
            std::cout << ", \"ok\": true, \"mode\": \"none\", \"frameCount\": 0, \"samples\": [] }";
            return;
        }

        const rs::SeqType* seq = nullptr;
        rs::Status st = session.tryGetSeqType(seqId, &seq);
        if (!rs::ok(st) || !seq) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
            return;
        }

        const bool skeletalMode = seq->animMayaId >= 0;
        if (skeletalMode) {
            const rs::i32 frameCount = seq->animMayaEnd - seq->animMayaStart;
            rs::SkeletalSeq skeletal{};
            const rs::Status sks = session.tryLoadSkeletalSeq(seq->animMayaId, &skeletal);

            std::cout << ", \"ok\": true, \"mode\": \"skeletal\", \"frameCount\": " << frameCount;
            std::cout << ", \"animMayaId\": " << seq->animMayaId;
            std::cout << ", \"animMayaStart\": " << seq->animMayaStart;
            std::cout << ", \"animMayaEnd\": " << seq->animMayaEnd;
            std::cout << ", \"skeletalOk\": " << (rs::ok(sks) ? "true" : "false");
            if (!rs::ok(sks)) {
                std::cout << ", \"skeletalStatus\": ";
                writeJsonEscaped(std::cout, std::string(statusName(sks)));
                std::cout << ", \"skeletalErrorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(sks)));
            } else {
                std::cout << ", \"skeletalHasAlphaTransform\": " << (skeletal.hasAlphaTransform ? "true" : "false");
            }
            std::cout << ", \"samples\": [";
            const std::size_t sampleCount =
                (frameCount > 0) ? std::min<std::size_t>(static_cast<std::size_t>(frameCount), static_cast<std::size_t>(args.maxFrames)) : 0;
            for (std::size_t i = 0; i < sampleCount; i++) {
                if (i > 0) std::cout << ", ";
                std::cout << "{ \"frame\": " << i << " }";
            }
            std::cout << "] }";
            return;
        }

        const std::size_t frameCount = seq->frameIds.size();
        const std::size_t sampleCount = std::min<std::size_t>(frameCount, static_cast<std::size_t>(args.maxFrames));
        std::cout << ", \"ok\": true, \"mode\": \"frame\", \"rotateNormals\": "
                  << (seq->rotateNormals ? "true" : "false")
                  << ", \"frameCount\": " << frameCount
                  << ", \"samples\": [";
        for (std::size_t i = 0; i < sampleCount; i++) {
            const rs::i32 frameId = seq->frameIds[i];
            rs::i32 frameLength = 0;
            rs::Status ls = session.tryGetSeqTypeFrameLength(*seq, static_cast<rs::i32>(i), &frameLength);
            if (!rs::ok(ls) && i < seq->frameLengths.size()) {
                frameLength = seq->frameLengths[i];
            }

            rs::SeqFrame frame(alloc);
            rs::Status fs = rs::Status::NotFound;
            if (frameId >= 0) {
                fs = session.tryLoadSeqFrame(frameId, &frame);
            }

            if (i > 0) std::cout << ", ";
            std::cout << "{ \"frame\": " << i
                      << ", \"frameId\": " << frameId
                      << ", \"frameLength\": " << frameLength
                      << ", \"frameOk\": " << (rs::ok(fs) ? "true" : "false");
            if (!rs::ok(fs)) {
                std::cout << ", \"frameStatus\": ";
                writeJsonEscaped(std::cout, std::string(statusName(fs)));
                std::cout << ", \"frameErrorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(fs)));
            } else {
                std::cout << ", \"hasAlphaTransform\": " << (frame.hasAlphaTransform ? "true" : "false")
                          << ", \"hasColorTransform\": " << (frame.hasColorTransform ? "true" : "false");
            }
            std::cout << " }";
        }
        std::cout << "] }";
    };

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"maxFrames\": " << args.maxFrames << ",\n";
    std::cout << "  \"npcs\": [\n";
    for (std::size_t i = 0; i < args.npcIds.size(); i++) {
        const rs::i32 id = static_cast<rs::i32>(args.npcIds[i]);
        std::cout << "    { \"id\": " << id;
        const rs::NpcType* npc = nullptr;
        rs::Status st = session.tryGetNpcType(id, &npc);
        if (!rs::ok(st) || !npc) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            rs::i32 idleSeqId = npc->idleSeqId;
            rs::i32 walkSeqId = npc->walkSeqId;
            rs::Status basStatus = rs::Status::NotFound;
            if (npc->basTypeId != -1) {
                const rs::BasType* bas = nullptr;
                basStatus = session.tryGetBasType(npc->basTypeId, &bas);
                if (rs::ok(basStatus) && bas) {
                    idleSeqId = bas->idleSeqId;
                    walkSeqId = bas->walkSeqId;
                } else {
                    idleSeqId = -1;
                    walkSeqId = -1;
                }
            }
            std::cout << ", \"ok\": true";
            std::cout << ", \"basTypeId\": " << npc->basTypeId;
            std::cout << ", \"npcIdleSeqId\": " << npc->idleSeqId;
            std::cout << ", \"npcWalkSeqId\": " << npc->walkSeqId;
            std::cout << ", \"idleSeqId\": " << idleSeqId;
            std::cout << ", \"walkSeqId\": " << walkSeqId;
            if (npc->basTypeId != -1) {
                std::cout << ", \"basStatus\": ";
                writeJsonEscaped(std::cout, std::string(statusName(basStatus)));
                std::cout << ", \"basErrorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(basStatus)));
            }
            std::cout << ", \"idle\": ";
            writeSeqResolution(idleSeqId);
            std::cout << ", \"walk\": ";
            writeSeqResolution(walkSeqId);
            std::cout << " }";
        }
        if (i + 1 < args.npcIds.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ],\n";
    std::cout << "  \"locs\": [\n";
    for (std::size_t i = 0; i < args.locIds.size(); i++) {
        const rs::i32 id = static_cast<rs::i32>(args.locIds[i]);
        std::cout << "    { \"id\": " << id;
        const rs::LocType* loc = nullptr;
        rs::Status st = session.tryGetLocType(id, &loc);
        if (!rs::ok(st) || !loc) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            rs::i32 selectedSeqId = loc->seqId;
            const char* source = "seqId";
            if (selectedSeqId == -1) {
                if (loc->randomSeqIds.size() > 0) {
                    selectedSeqId = loc->randomSeqIds[0];
                    source = "randomSeqIds_0";
                } else {
                    source = "none";
                }
            }
            std::cout << ", \"ok\": true";
            std::cout << ", \"seqId\": " << loc->seqId;
            std::cout << ", \"randomSeqCount\": " << loc->randomSeqIds.size();
            std::cout << ", \"selectedSeqId\": " << selectedSeqId;
            std::cout << ", \"selectionSource\": ";
            writeJsonEscaped(std::cout, std::string(source));
            std::cout << ", \"seq\": ";
            writeSeqResolution(selectedSeqId);
            std::cout << " }";
        }
        if (i + 1 < args.locIds.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdTransformSnapshot(int argc, char** argv) {
    const TransformSnapshotArgs args = parseTransformSnapshotArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.maxSteps <= 0) {
        throw std::runtime_error("Invalid --maxSteps");
    }
    if (args.npcIds.empty() && args.locIds.empty()) {
        throw std::runtime_error("Missing --npcIds and/or --locIds");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);

    struct SnapshotVarProvider final : rs::VarProvider {
        const rs::CacheSession& session;
        const std::unordered_map<int, int>& varps;
        const std::unordered_map<int, int>& directVarbits;

        SnapshotVarProvider(
            const rs::CacheSession& session_,
            const std::unordered_map<int, int>& varps_,
            const std::unordered_map<int, int>& directVarbits_) noexcept
            : session(session_), varps(varps_), directVarbits(directVarbits_) {}

        rs::i32 getVarp(rs::i32 id) const noexcept override {
            const auto it = varps.find(static_cast<int>(id));
            if (it == varps.end()) {
                return 0;
            }
            return static_cast<rs::i32>(it->second);
        }

        rs::i32 getVarbit(rs::i32 id) const noexcept override {
            const auto forced = directVarbits.find(static_cast<int>(id));
            if (forced != directVarbits.end()) {
                return static_cast<rs::i32>(forced->second);
            }

            const rs::VarBitType* varbit = nullptr;
            const rs::Status s = session.tryGetVarBitType(id, &varbit);
            if (!rs::ok(s) || !varbit) {
                return 0;
            }

            const rs::i32 baseValue = getVarp(varbit->baseVar);
            const rs::i32 startBit = (varbit->startBit < 0) ? 0 : ((varbit->startBit > 31) ? 31 : varbit->startBit);
            const rs::i32 endBit = (varbit->endBit < 0) ? 0 : ((varbit->endBit > 31) ? 31 : varbit->endBit);
            const rs::i32 width = endBit - startBit;
            if (width <= 0) {
                return 0;
            }

            const rs::u32 mask = (width >= 31) ? 0x7fffffffu : ((1u << width) - 1u);
            const rs::i32 shifted = (startBit >= 31) ? ((baseValue < 0) ? -1 : 0) : (baseValue >> startBit);
            return static_cast<rs::i32>(static_cast<rs::u32>(shifted) & mask);
        }
    };

    const SnapshotVarProvider varProvider(session, args.varps, args.varbits);

    const auto writeAssignments = [&](const std::unordered_map<int, int>& values) {
        std::vector<std::pair<int, int>> items;
        items.reserve(values.size());
        for (const auto& kv : values) {
            items.push_back(kv);
        }
        std::sort(items.begin(), items.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
        std::cout << "[";
        for (std::size_t i = 0; i < items.size(); i++) {
            if (i > 0) std::cout << ", ";
            std::cout << "{ \"id\": " << items[i].first << ", \"value\": " << items[i].second << " }";
        }
        std::cout << "]";
    };

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"maxSteps\": " << args.maxSteps << ",\n";
    std::cout << "  \"varps\": ";
    writeAssignments(args.varps);
    std::cout << ",\n";
    std::cout << "  \"varbits\": ";
    writeAssignments(args.varbits);
    std::cout << ",\n";

    std::cout << "  \"npcs\": [\n";
    for (std::size_t i = 0; i < args.npcIds.size(); i++) {
        const rs::i32 id = static_cast<rs::i32>(args.npcIds[i]);
        std::cout << "    { \"id\": " << id;
        const rs::NpcType* npc = nullptr;
        rs::Status st = session.tryGetNpcType(id, &npc);
        if (!rs::ok(st) || !npc) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            std::vector<rs::i32> visitedIds;
            visitedIds.push_back(id);
            std::unordered_set<rs::i32> seen;
            seen.insert(id);

            const rs::NpcType* current = npc;
            std::string terminal = "no_transforms";
            rs::Status terminalStatus = rs::Status::Ok;
            bool hasTerminalStatus = false;
            bool done = false;

            std::cout << ", \"ok\": true, \"chain\": [";
            std::size_t chainCount = 0;
            for (int step = 0; step < args.maxSteps; step++) {
                if (current->transforms.empty()) {
                    terminal = "no_transforms";
                    done = true;
                    break;
                }

                const rs::i32 transformIndex = current->resolveTransformIndex(varProvider);
                const rs::i32 selectedId = current->resolveTransformId(transformIndex);

                if (chainCount > 0) std::cout << ", ";
                std::cout << "{ \"sourceId\": " << current->id
                          << ", \"transformVarbit\": " << current->transformVarbit
                          << ", \"transformVarp\": " << current->transformVarp
                          << ", \"transformIndex\": " << transformIndex
                          << ", \"selectedId\": " << selectedId;

                if (selectedId == -1) {
                    std::cout << ", \"selectedStatus\": \"TransformMinusOne\" }";
                    terminal = "transform_minus_one";
                    done = true;
                    chainCount++;
                    break;
                }

                if (seen.find(selectedId) != seen.end()) {
                    std::cout << ", \"selectedStatus\": \"Cycle\" }";
                    visitedIds.push_back(selectedId);
                    terminal = "cycle";
                    done = true;
                    chainCount++;
                    break;
                }

                const rs::NpcType* next = nullptr;
                const rs::Status nextStatus = session.tryGetNpcType(selectedId, &next);
                if (!rs::ok(nextStatus) || !next) {
                    const rs::Status norm = rs::ok(nextStatus) ? rs::Status::NotFound : nextStatus;
                    std::cout << ", \"selectedStatus\": ";
                    writeJsonEscaped(std::cout, std::string(statusName(norm)));
                    std::cout << ", \"selectedErrorClass\": ";
                    writeJsonEscaped(std::cout, std::string(statusErrorClass(norm)));
                    std::cout << " }";
                    terminal = "loader_error";
                    terminalStatus = norm;
                    hasTerminalStatus = true;
                    done = true;
                    chainCount++;
                    break;
                }

                std::cout << ", \"selectedStatus\": \"Ok\" }";
                seen.insert(selectedId);
                visitedIds.push_back(selectedId);
                current = next;
                chainCount++;
            }
            if (!done) {
                terminal = "max_steps";
            }
            std::cout << "]";

            std::cout << ", \"visitedIds\": [";
            for (std::size_t vi = 0; vi < visitedIds.size(); vi++) {
                if (vi > 0) std::cout << ", ";
                std::cout << visitedIds[vi];
            }
            std::cout << "]";
            std::cout << ", \"finalId\": " << visitedIds.back();
            std::cout << ", \"terminal\": ";
            writeJsonEscaped(std::cout, terminal);
            if (hasTerminalStatus) {
                std::cout << ", \"terminalStatus\": ";
                writeJsonEscaped(std::cout, std::string(statusName(terminalStatus)));
                std::cout << ", \"terminalErrorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(terminalStatus)));
            }
            std::cout << " }";
        }
        if (i + 1 < args.npcIds.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ],\n";

    std::cout << "  \"locs\": [\n";
    for (std::size_t i = 0; i < args.locIds.size(); i++) {
        const rs::i32 id = static_cast<rs::i32>(args.locIds[i]);
        std::cout << "    { \"id\": " << id;
        const rs::LocType* loc = nullptr;
        rs::Status st = session.tryGetLocType(id, &loc);
        if (!rs::ok(st) || !loc) {
            if (rs::ok(st)) st = rs::Status::NotFound;
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            std::vector<rs::i32> visitedIds;
            visitedIds.push_back(id);
            std::unordered_set<rs::i32> seen;
            seen.insert(id);

            const rs::LocType* current = loc;
            std::string terminal = "no_transforms";
            rs::Status terminalStatus = rs::Status::Ok;
            bool hasTerminalStatus = false;
            bool done = false;

            std::cout << ", \"ok\": true, \"chain\": [";
            std::size_t chainCount = 0;
            for (int step = 0; step < args.maxSteps; step++) {
                if (current->transforms.empty()) {
                    terminal = "no_transforms";
                    done = true;
                    break;
                }

                const rs::i32 transformIndex = current->resolveTransformIndex(varProvider);
                const rs::i32 selectedId = current->resolveTransformId(transformIndex);

                if (chainCount > 0) std::cout << ", ";
                std::cout << "{ \"sourceId\": " << current->id
                          << ", \"transformVarbit\": " << current->transformVarbit
                          << ", \"transformVarp\": " << current->transformVarp
                          << ", \"transformIndex\": " << transformIndex
                          << ", \"selectedId\": " << selectedId;

                if (selectedId == -1) {
                    std::cout << ", \"selectedStatus\": \"TransformMinusOne\" }";
                    terminal = "transform_minus_one";
                    done = true;
                    chainCount++;
                    break;
                }

                if (seen.find(selectedId) != seen.end()) {
                    std::cout << ", \"selectedStatus\": \"Cycle\" }";
                    visitedIds.push_back(selectedId);
                    terminal = "cycle";
                    done = true;
                    chainCount++;
                    break;
                }

                const rs::LocType* next = nullptr;
                const rs::Status nextStatus = session.tryGetLocType(selectedId, &next);
                if (!rs::ok(nextStatus) || !next) {
                    const rs::Status norm = rs::ok(nextStatus) ? rs::Status::NotFound : nextStatus;
                    std::cout << ", \"selectedStatus\": ";
                    writeJsonEscaped(std::cout, std::string(statusName(norm)));
                    std::cout << ", \"selectedErrorClass\": ";
                    writeJsonEscaped(std::cout, std::string(statusErrorClass(norm)));
                    std::cout << " }";
                    terminal = "loader_error";
                    terminalStatus = norm;
                    hasTerminalStatus = true;
                    done = true;
                    chainCount++;
                    break;
                }

                std::cout << ", \"selectedStatus\": \"Ok\" }";
                seen.insert(selectedId);
                visitedIds.push_back(selectedId);
                current = next;
                chainCount++;
            }
            if (!done) {
                terminal = "max_steps";
            }
            std::cout << "]";

            std::cout << ", \"visitedIds\": [";
            for (std::size_t vi = 0; vi < visitedIds.size(); vi++) {
                if (vi > 0) std::cout << ", ";
                std::cout << visitedIds[vi];
            }
            std::cout << "]";
            std::cout << ", \"finalId\": " << visitedIds.back();
            std::cout << ", \"terminal\": ";
            writeJsonEscaped(std::cout, terminal);
            if (hasTerminalStatus) {
                std::cout << ", \"terminalStatus\": ";
                writeJsonEscaped(std::cout, std::string(statusName(terminalStatus)));
                std::cout << ", \"terminalErrorClass\": ";
                writeJsonEscaped(std::cout, std::string(statusErrorClass(terminalStatus)));
            }
            std::cout << " }";
        }
        if (i + 1 < args.locIds.size()) std::cout << ",";
        std::cout << "\n";
    }
    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdConfigTypeHashes(int argc, char** argv) {
    const ConfigTypeHashArgs args = parseConfigTypeHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.kind.empty()) {
        throw std::runtime_error("Missing --kind <...>");
    }
    if (args.ids.empty()) {
        throw std::runtime_error("Missing --ids <comma-separated>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    std::vector<rs::i32> indexIds;
    // We need at least configs (2). For some kinds we also need sprites (8) and OSRS defaults (17).
    indexIds.push_back(static_cast<rs::i32>(rs::Dat2IndexId::configs));
    const int idxLocs = static_cast<int>(rs::Rs2IndexId::locs);
    const int idxNpcs = static_cast<int>(rs::Rs2IndexId::npcs);
    const int idxObjs = static_cast<int>(rs::Rs2IndexId::objs);
    const int idxSeqs = static_cast<int>(rs::Rs2IndexId::seqs);
    const int idxVarBits = static_cast<int>(rs::Rs2IndexId::varbits);
    const int idxRs2Defaults = static_cast<int>(rs::Rs2IndexId::defaults);
    const int idxSprites = static_cast<int>(rs::Dat2IndexId::sprites);
    const int idxOsrsDefaults = static_cast<int>(rs::OsrsIndexId::graphicDefaults);
    if (rscli::dat2HasIndexFile(cacheDir, idxLocs)) indexIds.push_back(static_cast<rs::i32>(idxLocs));
    if (rscli::dat2HasIndexFile(cacheDir, idxNpcs)) indexIds.push_back(static_cast<rs::i32>(idxNpcs));
    if (rscli::dat2HasIndexFile(cacheDir, idxObjs)) indexIds.push_back(static_cast<rs::i32>(idxObjs));
    if (rscli::dat2HasIndexFile(cacheDir, idxSeqs)) indexIds.push_back(static_cast<rs::i32>(idxSeqs));
    if (rscli::dat2HasIndexFile(cacheDir, idxVarBits)) indexIds.push_back(static_cast<rs::i32>(idxVarBits));
    if (rscli::dat2HasIndexFile(cacheDir, idxRs2Defaults)) indexIds.push_back(static_cast<rs::i32>(idxRs2Defaults));
    if (rscli::dat2HasIndexFile(cacheDir, idxSprites)) indexIds.push_back(static_cast<rs::i32>(idxSprites));
    if (rscli::dat2HasIndexFile(cacheDir, idxOsrsDefaults)) indexIds.push_back(static_cast<rs::i32>(idxOsrsDefaults));

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType cacheType = rs::detectCacheType(cacheInfo);
    if (cacheType != rs::CacheType::Dat2) {
        throw std::runtime_error("config_type_hashes requires cacheType=dat2 for the provided game/revision");
    }

    Dat2CliCache opened = rscli::openDat2CacheSystemForCliWithIndexIds(
        cacheDir,
        cacheInfo,
        rs::Span<const rs::i32>(indexIds.data(), indexIds.size()),
        compression,
        alloc);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;
    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    const rs::CacheRules* rulesPtr = nullptr;
    if (!rs::ok(session.tryGetCacheRules(&rulesPtr)) || !rulesPtr) {
        throw std::runtime_error("Failed to get cache rules from session");
    }
    const rs::CacheRules rules = *rulesPtr;

    const rs::CacheIndex* configIndex = nullptr;
    rs::Status configIndexStatus = session.tryGetIndex(static_cast<rs::i32>(rs::Dat2IndexId::configs), &configIndex);
    if (!rs::ok(configIndexStatus) || !configIndex) {
        configIndex = nullptr;
    }

    const bool wantIndexConfigs =
        rules.isIndexConfigs &&
        (args.kind == "loc" || args.kind == "npc" || args.kind == "obj" || args.kind == "seq" || args.kind == "varbit");

    rs::i32 indexConfigsIndexId = -1;
    bool hasIndexConfigsIndex = false;
    rs::i32 indexConfigsFileIdBits = 0;
    if (wantIndexConfigs) {
        rs::i32 indexId = -1;
        if (args.kind == "loc") {
            indexId = static_cast<rs::i32>(rs::Rs2IndexId::locs);
            indexConfigsFileIdBits = 8;
        } else if (args.kind == "npc") {
            indexId = static_cast<rs::i32>(rs::Rs2IndexId::npcs);
            indexConfigsFileIdBits = 7;
        } else if (args.kind == "obj") {
            indexId = static_cast<rs::i32>(rs::Rs2IndexId::objs);
            indexConfigsFileIdBits = 8;
        } else if (args.kind == "seq") {
            indexId = static_cast<rs::i32>(rs::Rs2IndexId::seqs);
            indexConfigsFileIdBits = 7;
        } else if (args.kind == "varbit") {
            indexId = static_cast<rs::i32>(rs::Rs2IndexId::varbits);
            indexConfigsFileIdBits = 10;
        }
        const rs::CacheIndex* indexConfigsIndex = nullptr;
        const rs::Status s = session.tryGetIndex(indexId, &indexConfigsIndex);
        if (rs::ok(s) && indexConfigsIndex) {
            indexConfigsIndexId = indexId;
            hasIndexConfigsIndex = true;
        }
    }

    rs::i32 dat2ConfigArchiveId = -1;
    if (!wantIndexConfigs) {
        if (args.kind == "underlay") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::underlays);
        else if (args.kind == "overlay") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::overlays);
        else if (args.kind == "idk") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::identkits);
        else if (args.kind == "inv") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::inv);
        else if (args.kind == "varbit") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::varbits);
        else if (args.kind == "enum") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::enums);
        else if (args.kind == "param") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::params);
        else if (args.kind == "loc") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::locs);
        else if (args.kind == "npc") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::npcs);
        else if (args.kind == "obj") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::objs);
        else if (args.kind == "seq") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::seqs);
        else if (args.kind == "spotanim") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::spotAnims);
        else if (args.kind == "bas") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Rs2ConfigArchiveId::bas);
        else if (args.kind == "quest") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Rs2ConfigArchiveId::quests);
        else if (args.kind == "mapscene") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Rs2ConfigArchiveId::mapScenes);
        else if (args.kind == "mapelement") {
            if (rules.mapFunctions == rs::MapFunctionsMode::OsrsArchive) {
                dat2ConfigArchiveId = static_cast<rs::i32>(rs::OsrsConfigArchiveId::mapFunctions);
            } else if (rules.mapFunctions == rs::MapFunctionsMode::Rs2Archive) {
                dat2ConfigArchiveId = static_cast<rs::i32>(rs::Rs2ConfigArchiveId::mapFunctions);
            }
        } else if (args.kind == "struct") {
            if (rules.mapFunctions == rs::MapFunctionsMode::OsrsArchive) {
                dat2ConfigArchiveId = static_cast<rs::i32>(rs::OsrsConfigArchiveId::struct_);
            }
        } else if (args.kind == "varplayer") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::varps);
        else if (args.kind == "varclient_int") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::varClient);
        else if (args.kind == "varclient_str") dat2ConfigArchiveId = static_cast<rs::i32>(rs::Dat2ConfigArchiveId::varClientString);
    }

    std::optional<rs::Archive> configArchiveOpt;
    if (!wantIndexConfigs) {
        if (dat2ConfigArchiveId >= 0) {
            auto archRes = session.tryGetArchive(static_cast<rs::i32>(rs::Dat2IndexId::configs), dat2ConfigArchiveId, alloc);
            if (archRes.isOk()) {
                configArchiveOpt = std::move(archRes.value());
            } else if (archRes.status() != rs::Status::NotFound) {
                throw std::runtime_error(std::string("Failed to read config archive: ") + statusName(archRes.status()));
            }
        }
    }

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"kind\": ";
    writeJsonEscaped(std::cout, args.kind);
    std::cout << ",\n";
    std::cout << "  \"entries\": [\n";

    std::unordered_map<rs::i32, rs::Archive> indexArchiveCache;
    std::optional<rs::GraphicsDefaults> graphicsDefaultsOpt;
    rs::Status graphicsDefaultsStatus = rs::Status::Ok;
    if (args.kind == "graphics_defaults") {
        auto gdRes = session.tryGetGraphicsDefaults(alloc);
        if (!gdRes.isOk()) {
            graphicsDefaultsStatus = gdRes.error().status;
        } else {
            graphicsDefaultsOpt = std::move(gdRes.value());
        }
    }

    for (std::size_t i = 0; i < args.ids.size(); i++) {
        const int id = args.ids[i];
        std::cout << "    { \"id\": " << id;

        rs::Status st = rs::Status::Ok;
        rs::u32 hash = 0;

        if (args.kind == "graphics_defaults") {
            if (!rs::ok(graphicsDefaultsStatus) || !graphicsDefaultsOpt.has_value()) {
                st = graphicsDefaultsStatus;
            } else {
                hash = hashGraphicsDefaults(*graphicsDefaultsOpt);
            }
        } else if (wantIndexConfigs) {
            if (!hasIndexConfigsIndex || indexConfigsFileIdBits <= 0) {
                st = rs::Status::NotFound;
            } else {
                const rs::i32 fileIdMask = static_cast<rs::i32>((1u << static_cast<rs::u32>(indexConfigsFileIdBits)) - 1u);
                const rs::i32 archiveId = static_cast<rs::i32>(id) >> indexConfigsFileIdBits;
                const rs::i32 fileId = static_cast<rs::i32>(id) & fileIdMask;

                auto it = indexArchiveCache.find(archiveId);
                if (it == indexArchiveCache.end()) {
                    auto archRes = session.tryGetArchive(indexConfigsIndexId, archiveId, alloc);
                    if (!archRes.isOk()) {
                        st = archRes.status();
                    } else {
                        auto ins = indexArchiveCache.emplace(archiveId, std::move(archRes.value()));
                        it = ins.first;
                    }
                }

                if (st == rs::Status::Ok) {
                    const rs::Span<const rs::ArchiveFile> files = it->second.files();
                    const rs::ArchiveFile* f = nullptr;
                    for (std::size_t fi = 0; fi < files.size(); fi++) {
                        if (files[fi].id == fileId) {
                            f = &files[fi];
                            break;
                        }
                    }
                    if (!f) {
                        st = rs::Status::NotFound;
                    } else {
                        const rs::Span<const rs::u8> bytes(f->data.data(), f->data.size());
                        if (args.kind == "loc") {
                            st = decodeTypeAndHash<rs::LocType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashLocType, &hash);
                        } else if (args.kind == "npc") {
                            st = decodeTypeAndHash<rs::NpcType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashNpcType, &hash);
                        } else if (args.kind == "obj") {
                            st = decodeTypeAndHash<rs::ObjType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashObjType, &hash);
                        } else if (args.kind == "seq") {
                            st = decodeTypeAndHash<rs::SeqType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashSeqType, &hash);
                        } else if (args.kind == "varbit") {
                            st = decodeTypeAndHash<rs::VarBitType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashVarBitType, &hash);
                        } else {
                            st = rs::Status::InvalidArgument;
                        }
                    }
                }
            }
        } else {
            if (!configIndex || !configArchiveOpt.has_value()) {
                st = rs::Status::NotFound;
            } else {
                const rs::Archive& archive = *configArchiveOpt;
                const rs::Span<const rs::ArchiveFile> files = archive.files();
                const rs::ArchiveFile* f = nullptr;
                for (std::size_t fi = 0; fi < files.size(); fi++) {
                    if (files[fi].id == static_cast<rs::i32>(id)) {
                        f = &files[fi];
                        break;
                    }
                }
                if (!f) {
                    st = rs::Status::NotFound;
                } else {
                    const rs::Span<const rs::u8> bytes(f->data.data(), f->data.size());
                    if (args.kind == "underlay") {
                        st = decodeTypeAndHash<rs::UnderlayFloorType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashUnderlayFloorType, &hash);
                    } else if (args.kind == "overlay") {
                        st = decodeTypeAndHash<rs::OverlayFloorType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashOverlayFloorType, &hash);
                    } else if (args.kind == "idk") {
                        st = decodeTypeAndHash<rs::IdkType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashIdkType, &hash);
                    } else if (args.kind == "inv") {
                        st = decodeTypeAndHash<rs::InvType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashInvType, &hash);
                    } else if (args.kind == "varbit") {
                        st = decodeTypeAndHash<rs::VarBitType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashVarBitType, &hash);
                    } else if (args.kind == "enum") {
                        st = decodeTypeAndHash<rs::EnumType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashEnumType, &hash);
                    } else if (args.kind == "param") {
                        st = decodeTypeAndHash<rs::ParamType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashParamType, &hash);
                    } else if (args.kind == "loc") {
                        st = decodeTypeAndHash<rs::LocType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashLocType, &hash);
                    } else if (args.kind == "npc") {
                        st = decodeTypeAndHash<rs::NpcType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashNpcType, &hash);
                    } else if (args.kind == "obj") {
                        st = decodeTypeAndHash<rs::ObjType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashObjType, &hash);
                    } else if (args.kind == "seq") {
                        st = decodeTypeAndHash<rs::SeqType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashSeqType, &hash);
                    } else if (args.kind == "spotanim") {
                        st = decodeTypeAndHash<rs::SpotAnimType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashSpotAnimType, &hash);
                    } else if (args.kind == "bas") {
                        st = decodeTypeAndHash<rs::BasType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashBasType, &hash);
                    } else if (args.kind == "quest") {
                        st = decodeTypeAndHash<rs::QuestType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashQuestType, &hash);
                    } else if (args.kind == "mapscene") {
                        st = decodeTypeAndHash<rs::MapSceneType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashMapSceneType, &hash);
                    } else if (args.kind == "mapelement") {
                        st = decodeTypeAndHash<rs::MapElementType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashMapElementType, &hash);
                    } else if (args.kind == "struct") {
                        st = decodeTypeAndHash<rs::StructType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashStructType, &hash);
                    } else if (args.kind == "varplayer") {
                        st = decodeTypeAndHash<rs::VarPlayerType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashVarPlayerType, &hash);
                    } else if (args.kind == "varclient_int") {
                        st = decodeTypeAndHash<rs::VarClientIntType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashVarClientIntType, &hash);
                    } else if (args.kind == "varclient_str") {
                        st = decodeTypeAndHash<rs::VarClientStrType>(cacheInfo, static_cast<rs::i32>(id), bytes, alloc, hashVarClientStrType, &hash);
                    } else {
                        st = rs::Status::InvalidArgument;
                    }
                }
            }
        }

        if (!rs::ok(st)) {
            std::cout << ", \"ok\": false, \"status\": ";
            writeJsonEscaped(std::cout, std::string(statusName(st)));
            std::cout << ", \"errorClass\": ";
            writeJsonEscaped(std::cout, std::string(statusErrorClass(st)));
            std::cout << ", \"statusCode\": " << static_cast<int>(st) << " }";
        } else {
            std::cout << ", \"ok\": true, \"hash\": " << static_cast<rs::i32>(hash) << " }";
        }

        if (i + 1 < args.ids.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";
    return 0;
}

static int cmdSessionContract(int argc, char** argv) {
    const SessionContractArgs args = parseSessionContractArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    const rs::CacheType expectedType = rs::detectCacheType(cacheInfo);
    const std::optional<CacheKind> kind = rscli::detectCacheKind(cacheDir);
    if (!kind.has_value()) {
        throw std::runtime_error("Unable to detect cache kind from files");
    }

    if ((*kind == CacheKind::Dat2 && expectedType != rs::CacheType::Dat2) ||
        (*kind == CacheKind::Dat && expectedType != rs::CacheType::Dat) ||
        (*kind == CacheKind::Legacy && expectedType != rs::CacheType::Legacy)) {
        throw std::runtime_error("Provided --game/--revision does not match detected cache files");
    }

    std::optional<Dat2CliCache> dat2Opened;
    std::optional<GenericCliCache> genericOpened;
    rs::CacheSystem* cacheSystem = nullptr;
    if (*kind == CacheKind::Dat2) {
        dat2Opened.emplace(openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/true));
        cacheSystem = &dat2Opened->cacheSystem;
    } else if (*kind == CacheKind::Dat) {
        genericOpened.emplace(rscli::openDatCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    } else {
        genericOpened.emplace(rscli::openLegacyCacheSystemForCli(cacheDir, cacheInfo, compression, alloc));
        cacheSystem = &genericOpened->cacheSystem;
    }

    if (!cacheSystem) {
        throw std::runtime_error("Failed to initialize cache system");
    }

    rs::CacheSession session = createSessionOrThrow(*cacheSystem, cacheInfo, alloc);
    const rs::Loaders::Capabilities sessionCaps = rs::Loaders::capabilitiesFor(session);
    assertSessionStatusContract(session, sessionCaps);
    const bool hasTextureService = session.hasTextureService();
    const bool hasMapFileService = session.hasMapFileService();
    const bool hasModelService = session.hasModelService();
    const bool hasSeqFrameService = session.hasSeqFrameService();

    rs::MapScenesMode mapScenesMode = rs::MapScenesMode::GraphicsDefaults;
    rs::MapFunctionsMode mapFunctionsMode = rs::MapFunctionsMode::GraphicsDefaults;
    if (!rs::ok(session.tryGetMapRules(&mapScenesMode, &mapFunctionsMode))) {
        throw std::runtime_error("tryGetMapRules failed");
    }
    rs::TextureRules textureRules{};
    if (!rs::ok(session.tryGetTextureRules(&textureRules))) {
        throw std::runtime_error("tryGetTextureRules failed");
    }

    session.clearCaches();

    auto forkRes = session.tryFork(alloc);
    if (!forkRes.isOk()) {
        throw std::runtime_error(initErrorToString(forkRes.error()));
    }
    const rs::Loaders::Capabilities forkCaps = rs::Loaders::capabilitiesFor(forkRes.value());
    if (forkCaps.cacheType != sessionCaps.cacheType ||
        forkCaps.hasQuestTypeLoader != sessionCaps.hasQuestTypeLoader ||
        forkCaps.hasSkeletalSeqLoader != sessionCaps.hasSkeletalSeqLoader ||
        forkCaps.hasDistinctUnderlayTypeLoader != sessionCaps.hasDistinctUnderlayTypeLoader) {
        throw std::runtime_error("fork capabilities mismatch");
    }

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"cache\": { \"name\": ";
    writeJsonEscaped(std::cout, cacheName);
    std::cout << ", \"game\": ";
    writeJsonEscaped(std::cout, args.gameName);
    std::cout << ", \"revision\": " << args.revision << " },\n";
    std::cout << "  \"cacheType\": ";
    writeJsonEscaped(std::cout, std::string(cacheTypeName(sessionCaps.cacheType)));
    std::cout << ",\n";
    std::cout << "  \"hasQuestTypeLoader\": " << (sessionCaps.hasQuestTypeLoader ? "true" : "false") << ",\n";
    std::cout << "  \"hasSkeletalSeqLoader\": " << (sessionCaps.hasSkeletalSeqLoader ? "true" : "false") << ",\n";
    std::cout << "  \"hasDistinctUnderlayTypeLoader\": " << (sessionCaps.hasDistinctUnderlayTypeLoader ? "true" : "false") << ",\n";
    std::cout << "  \"hasModelService\": " << (hasModelService ? "true" : "false") << ",\n";
    std::cout << "  \"hasSeqFrameService\": " << (hasSeqFrameService ? "true" : "false") << ",\n";
    std::cout << "  \"hasTextureService\": " << (hasTextureService ? "true" : "false") << ",\n";
    std::cout << "  \"hasMapFileService\": " << (hasMapFileService ? "true" : "false") << ",\n";
    std::cout << "  \"ok\": true\n";
    std::cout << "}\n";
    return 0;
}

static int cmdTextureOpHashes(int argc, char** argv) {
    const TextureOpHashArgs args = parseTextureOpHashArgs(argc, argv);
    const fs::path cacheDir = resolveCacheDir(args.cacheNameOrPath);
    if (args.gameName.empty()) {
        throw std::runtime_error("Missing --game <classic|runescape|oldschool>");
    }
    if (args.revision < 0) {
        throw std::runtime_error("Missing --revision <n>");
    }
    if (args.id < 0) {
        throw std::runtime_error("Missing --id <n>");
    }
    if (args.size <= 0) {
        throw std::runtime_error("Invalid --size");
    }

    rs::Allocator& alloc = rs::defaultAllocator();
    rs::NativeCompressionHandler compression;

    rs::CacheInfo cacheInfo{};
    const std::string cacheName = cacheDir.filename().string();
    cacheInfo.name = cacheName.c_str();
    cacheInfo.game = parseGameType(args.gameName);
    cacheInfo.revision = static_cast<rs::i32>(args.revision);

    Dat2CliCache opened = openDat2CacheSystemForCli(cacheDir, cacheInfo, compression, alloc, /*includeMaps=*/false);
    rs::CacheSystem& cacheSystem = opened.cacheSystem;

    rs::CacheSession session = createSessionOrThrow(cacheSystem, cacheInfo, alloc);

    if (session.textureMode() == rs::TextureMode::Sprite) {
        throw std::runtime_error("texture_op_hashes only supports procedural texture modes");
    }

    if (session.textureMode() != rs::TextureMode::Materials) {
        throw std::runtime_error("texture_op_hashes currently supports materials procedural textures only");
    }

    const rs::ProceduralTextureLoader* procLoader = nullptr;
    const rs::Status procStatus = session.tryGetProceduralTextureLoader(&procLoader);
    if (!rs::ok(procStatus) || !procLoader) {
        throw std::runtime_error(std::string("Failed to get procedural texture loader: ") + statusName(procStatus));
    }

    const rs::ProceduralTextureDefinition* def = nullptr;
    rs::Status s = procLoader->getTextureDefinition(static_cast<rs::i32>(args.id), &def);
    if (!rs::ok(s) || !def) {
        throw std::runtime_error(std::string("Texture definition not found: ") + statusName(s));
    }

    const rs::CacheIndex* spriteIndex = nullptr;
    s = session.tryGetSpritesIndex(&spriteIndex);
    if (!rs::ok(s) || !spriteIndex) {
        throw std::runtime_error("Failed to get sprites index");
    }

    rs::CacheSpriteSource spriteSource(*spriteIndex);
    rs::TextureGenerator gen(alloc);
    gen.spriteSource = &spriteSource;
    gen.textureSource = procLoader;

    const rs::Span<rs::TextureOperation* const> ops = def->procedural.operations();
    for (std::size_t i = 0; i < ops.size(); i++) {
        rs::TextureOperation* op = ops[i];
        if (!op) {
            throw std::runtime_error("Null operation pointer");
        }
        const rs::Status is = op->initCaches(gen, args.size, args.size, alloc);
        if (!rs::ok(is)) {
            throw std::runtime_error(std::string("initCaches failed: ") + statusName(is));
        }
    }
    gen.initBrightness(args.brightness);
    const rs::Status initS = gen.init(args.size, args.size);
    if (!rs::ok(initS)) {
        throw std::runtime_error(std::string("TextureGenerator::init failed: ") + statusName(initS));
    }

    std::cout << "{\n";
    std::cout << "  \"schema\": 1,\n";
    std::cout << "  \"id\": " << args.id << ",\n";
    std::cout << "  \"size\": " << args.size << ",\n";
    std::cout << "  \"brightness\": " << args.brightness << ",\n";
    std::cout << "  \"flipH\": " << (args.flipH ? "true" : "false") << ",\n";
    std::cout << "  \"opHashes\": [\n";

    const auto indexOfOp = [&](rs::TextureOperation* needle) -> int {
        if (!needle) return -1;
        for (std::size_t j = 0; j < ops.size(); j++) {
            if (ops[j] == needle) {
                return static_cast<int>(j);
            }
        }
        return -1;
    };

    for (std::size_t i = 0; i < ops.size(); i++) {
        rs::TextureOperation* op = ops[i];
        rs::u32 h = 2166136261u;
        if (op->isMonochrome()) {
            for (rs::i32 line = 0; line < static_cast<rs::i32>(args.size); line++) {
                rs::Span<rs::i32> lineOut;
                const rs::Status ls = op->getMonochromeOutput(gen, line, &lineOut);
                if (!rs::ok(ls)) {
                    throw std::runtime_error(std::string("getMonochromeOutput failed: ") + statusName(ls));
                }
                for (std::size_t k = 0; k < lineOut.size(); k++) {
                    h = fnv1a32UpdateInt(h, lineOut[k]);
                }
            }
        } else {
            for (rs::i32 line = 0; line < static_cast<rs::i32>(args.size); line++) {
                rs::ColourLine c{};
                const rs::Status ls = op->getColourOutput(gen, line, &c);
                if (!rs::ok(ls)) {
                    throw std::runtime_error(std::string("getColourOutput failed: ") + statusName(ls));
                }
                for (std::size_t k = 0; k < c.r.size(); k++) h = fnv1a32UpdateInt(h, c.r[k]);
                for (std::size_t k = 0; k < c.g.size(); k++) h = fnv1a32UpdateInt(h, c.g[k]);
                for (std::size_t k = 0; k < c.b.size(); k++) h = fnv1a32UpdateInt(h, c.b[k]);
            }
        }

        std::cout << "    { \"opIndex\": " << i
                  << ", \"operationId\": " << op->operationId()
                  << ", \"cacheSlotCount\": " << static_cast<int>(op->cacheSlotCount())
                  << ", \"isMonochrome\": " << (op->isMonochrome() ? "true" : "false")
                  << ", \"inputs\": [";
        const rs::Span<rs::TextureOperation* const> ins = op->inputs();
        for (std::size_t j = 0; j < ins.size(); j++) {
            if (j > 0) std::cout << ", ";
            std::cout << indexOfOp(ins[j]);
        }
        std::cout << "], \"hash\": " << static_cast<rs::i32>(h) << " }";
        if (i + 1 < ops.size()) std::cout << ",";
        std::cout << "\n";
    }

    std::cout << "  ]\n";
    std::cout << "}\n";

    for (std::size_t i = 0; i < ops.size(); i++) {
        rs::TextureOperation* op = ops[i];
        if (op) {
            op->clearCaches();
        }
    }

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
        if (cmd == "texture_hashes") {
            return cmdTextureHashes(argc - 2, argv + 2);
        }
        if (cmd == "texture_op_hashes") {
            return cmdTextureOpHashes(argc - 2, argv + 2);
        }
        if (cmd == "terrain_square_hashes") {
            return cmdTerrainSquareHashes(argc - 2, argv + 2);
        }
        if (cmd == "loc_square_hashes") {
            return cmdLocSquareHashes(argc - 2, argv + 2);
        }
        if (cmd == "npc_spawn_square_hashes") {
            return cmdNpcSpawnSquareHashes(argc - 2, argv + 2);
        }
        if (cmd == "map_square_inputs_hashes") {
            return cmdMapSquareInputsHashes(argc - 2, argv + 2);
        }
        if (cmd == "model_hashes") {
            return cmdModelHashes(argc - 2, argv + 2);
        }
        if (cmd == "seq_frame_hashes") {
            return cmdSeqFrameHashes(argc - 2, argv + 2);
        }
        if (cmd == "skeletal_seq_hashes") {
            return cmdSkeletalSeqHashes(argc - 2, argv + 2);
        }
        if (cmd == "skeletal_eval_hashes") {
            return cmdSkeletalEvalHashes(argc - 2, argv + 2);
        }
        if (cmd == "skeletal_eval_bench") {
            return cmdSkeletalEvalBench(argc - 2, argv + 2);
        }
        if (cmd == "skeletal_model_hashes") {
            return cmdSkeletalModelHashes(argc - 2, argv + 2);
        }
        if (cmd == "seq_type_frame_lengths") {
            return cmdSeqTypeFrameLengths(argc - 2, argv + 2);
        }
        if (cmd == "anim_selection_snapshot") {
            return cmdAnimSelectionSnapshot(argc - 2, argv + 2);
        }
        if (cmd == "transform_snapshot") {
            return cmdTransformSnapshot(argc - 2, argv + 2);
        }
        if (cmd == "config_type_hashes") {
            return cmdConfigTypeHashes(argc - 2, argv + 2);
        }
        if (cmd == "session_contract") {
            return cmdSessionContract(argc - 2, argv + 2);
        }

        std::cerr << "Unknown command: " << cmd << "\n\n";
        printUsage();
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "ERROR: " << e.what() << "\n";
        return 1;
    }
}
