cmake_minimum_required(VERSION 3.20)

project(rs_cpp LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(rs_cache_parity
    tools/rs_cache_parity.cpp
    rs/io/ByteSourceSlice.cpp
    rs/io/Uint8ArrayByteSource.cpp
    rs/io/ByteSourceAccess.cpp
    rs/io/Uint8ArrayReader.cpp
    rs/crypto/Xtea.cpp
    rs/compression/NativeCompressionHandler.cpp
    rs/cache/format/Container.cpp
    rs/cache/format/Archive.cpp
    rs/cache/reference/ReferenceTable.cpp
    rs/cache/store/SectorChainStore.cpp
    rs/cache/Dat2CacheIndex.cpp
    rs/util/XXHash64.cpp

    third_party/miniz/miniz_tinfl.c
    third_party/bzip2/blocksort.c
    third_party/bzip2/bzlib.c
    third_party/bzip2/compress.c
    third_party/bzip2/crctable.c
    third_party/bzip2/decompress.c
    third_party/bzip2/huffman.c
    third_party/bzip2/randtable.c
    third_party/bzip2/bzip2_internal_error.c
)

target_include_directories(rs_cache_parity PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_definitions(rs_cache_parity PRIVATE
    BZ_NO_STDIO=1
    MINIZ_NO_STDIO=1
    MINIZ_NO_TIME=1
    MINIZ_NO_ARCHIVE_APIS=1
    MINIZ_NO_ZLIB_APIS=1
    MINIZ_NO_ZLIB_COMPATIBLE_NAMES=1
)
