cmake_minimum_required(VERSION 3.20)

project(rs_cpp LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Needed for clang-tidy / include-cleaner linting.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(RS_BUILD_TOOLS "Build command-line tools (native only by default)" ON)
option(RS_BUILD_TESTS "Build tests (native only by default)" ON)
option(RS_BUILD_WASM_SMOKE "Build a minimal wasm smoke target" OFF)

if (EMSCRIPTEN)
    # No CLI/tests for wasm yet (they depend on native filesystem + host execution).
    set(RS_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
    set(RS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(RS_BUILD_WASM_SMOKE ON CACHE BOOL "" FORCE)
endif()

add_library(rs STATIC
    rs/io/ByteSourceSlice.cpp
    rs/io/Uint8ArrayByteSource.cpp
    rs/io/ByteSourceReader.cpp
    rs/io/FileByteSource.cpp
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
    third_party/bzip2/bzlib.c
    third_party/bzip2/crctable.c
    third_party/bzip2/decompress.c
    third_party/bzip2/huffman.c
    third_party/bzip2/randtable.c
    third_party/bzip2/bzip2_internal_error.c
)

target_include_directories(rs PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

target_compile_definitions(rs PRIVATE
    BZ_NO_STDIO=1
    MINIZ_NO_STDIO=1
    MINIZ_NO_TIME=1
    MINIZ_NO_ARCHIVE_APIS=1
    MINIZ_NO_ZLIB_APIS=1
    MINIZ_NO_ZLIB_COMPATIBLE_NAMES=1
)

# Allow dead-stripping of unused library code.
target_compile_options(rs PRIVATE
    -ffunction-sections
    -fdata-sections
)

if (RS_BUILD_TOOLS)
    add_executable(rs_cli
        tools/rs_cli.cpp
    )

    target_link_libraries(rs_cli PRIVATE rs)

    target_link_options(rs_cli PRIVATE
        -Wl,--gc-sections
    )
endif()

if (RS_BUILD_TESTS)
    enable_testing()

    add_executable(rs_tests
        tests/rs_tests.cpp
    )

    target_link_libraries(rs_tests PRIVATE rs)

    target_link_options(rs_tests PRIVATE
        -Wl,--gc-sections
    )

    add_test(NAME rs_tests COMMAND rs_tests)
endif()

if (RS_BUILD_WASM_SMOKE)
    add_executable(rs_wasm_smoke
        tools/rs_wasm_smoke.cpp
    )

    target_link_libraries(rs_wasm_smoke PRIVATE rs)

    # Keep the output small-ish and fail fast on missing symbols.
    target_link_options(rs_wasm_smoke PRIVATE
        -Wl,--gc-sections
        -sERROR_ON_UNDEFINED_SYMBOLS=1
    )
endif()
