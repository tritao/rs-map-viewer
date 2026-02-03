#include "rs_core/archive_split.hpp"
#include "rs_core/sector_chain_store.hpp"
#include "rs_core/xtea.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

static std::vector<uint8_t> read_file_bytes(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        throw std::runtime_error("failed to open file: " + path);
    }
    f.seekg(0, std::ios::end);
    const std::streamsize size = f.tellg();
    f.seekg(0, std::ios::beg);

    std::vector<uint8_t> bytes;
    bytes.resize(static_cast<std::size_t>(size));
    if (size > 0) {
        f.read(reinterpret_cast<char*>(bytes.data()), size);
    }
    return bytes;
}

static void assert_bytes_eq(const std::vector<uint8_t>& got, const std::vector<uint8_t>& expected, const char* what) {
    if (got.size() != expected.size()) {
        throw std::runtime_error(std::string(what) + ": size mismatch got=" + std::to_string(got.size()) +
                                 " expected=" + std::to_string(expected.size()));
    }
    for (std::size_t i = 0; i < got.size(); i++) {
        if (got[i] != expected[i]) {
            throw std::runtime_error(std::string(what) + ": mismatch at " + std::to_string(i));
        }
    }
}

static std::string fixture_path(const std::string& rel) {
    return std::string(RS_FIXTURE_DIR) + "/" + rel;
}

static void test_xtea() {
    const auto input = read_file_bytes(fixture_path("xtea/input.bin"));
    const auto expected = read_file_bytes(fixture_path("xtea/expected.bin"));

    rs_core::XteaKey key{
        std::array<uint32_t, 4>{
            0x11223344u,
            0x55667788u,
            0x99aabbccu,
            0xddeeff00u,
        },
    };

    auto got = input;
    rs_core::xtea_decrypt_in_place(got, 0, got.size(), key);

    assert_bytes_eq(got, expected, "xtea");
}

static void test_sector_chain_store() {
    const auto dat = read_file_bytes(fixture_path("sectorchain/main_file_cache.dat"));
    const auto idx0 = read_file_bytes(fixture_path("sectorchain/main_file_cache.idx0"));
    const auto expected = read_file_bytes(fixture_path("sectorchain/expected-idx0-archive1.bin"));

    rs_core::SectorChainStore store(
        rs_core::ByteSource(dat),
        std::vector<std::optional<rs_core::ByteSource>>{
            rs_core::ByteSource(idx0),
        },
        std::nullopt);

    const auto got = store.read(/*index_id=*/0, /*archive_id=*/1);
    assert_bytes_eq(got, expected, "sectorchain");
}

static void test_archive_split() {
    const auto payload = read_file_bytes(fixture_path("archive-split/payload.bin"));
    const auto expected0 = read_file_bytes(fixture_path("archive-split/expected-file0.bin"));
    const auto expected1 = read_file_bytes(fixture_path("archive-split/expected-file1.bin"));

    const auto files = rs_core::archive_split_payload(payload, /*file_count=*/2);
    if (files.size() != 2) {
        throw std::runtime_error("archive_split: expected 2 files");
    }
    assert_bytes_eq(files[0], expected0, "archive_split file0");
    assert_bytes_eq(files[1], expected1, "archive_split file1");
}

int main() {
    try {
        test_xtea();
        test_sector_chain_store();
        test_archive_split();
    } catch (const std::exception& e) {
        std::cerr << "FAIL: " << e.what() << "\n";
        return 1;
    }
    std::cout << "OK\n";
    return 0;
}
