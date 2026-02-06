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
    # Default wasm bootstrap: build only the core static library (`librs.a`).
    # Enable RS_BUILD_WASM_SMOKE manually if you want a linked wasm executable wrapper.
    set(RS_BUILD_WASM_SMOKE OFF CACHE BOOL "" FORCE)
endif()

set(RS_SOURCES
    rs/io/ByteSourceSlice.cpp
    rs/io/Uint8ArrayByteSource.cpp
    rs/io/ByteSourceReader.cpp
    rs/io/Uint8ArrayReader.cpp
    rs/crypto/Xtea.cpp
    rs/compression/NativeCompressionHandler.cpp
    rs/cache/format/Container.cpp
    rs/cache/format/Archive.cpp
    rs/cache/reference/ReferenceTable.cpp
    rs/cache/store/SectorChainStore.cpp
    rs/cache/CacheIndex.cpp
    rs/cache/CacheSystem.cpp
    rs/util/XXHash64.cpp
    rs/config/vartype/VarBitTypeLoader.cpp
    rs/loaders/ConfigLoaders.cpp
)

if (NOT EMSCRIPTEN)
    list(APPEND RS_SOURCES
        rs/io/FileByteSource.cpp
    )
endif()

add_library(rs STATIC
    ${RS_SOURCES}

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
    $<$<COMPILE_LANGUAGE:CXX>:-fno-exceptions>
    $<$<COMPILE_LANGUAGE:CXX>:-fno-rtti>
)

# Guardrail: keep the core library STL-free (containers/strings/streams/etc.).
# Tools and tests may use STL, but `cpp/rs/**` should stay freestanding-friendly.
set(RS_CORE_STL_GUARD_SCRIPT "${CMAKE_CURRENT_BINARY_DIR}/rs_core_stl_guard.cmake")
file(WRITE "${RS_CORE_STL_GUARD_SCRIPT}" [=[
cmake_minimum_required(VERSION 3.20)

if (NOT DEFINED CORE_DIR)
  message(FATAL_ERROR "CORE_DIR not provided")
endif()

set(banned_headers
  algorithm
  any
  array
  deque
  exception
  filesystem
  forward_list
  fstream
  functional
  future
  iostream
  istream
  iterator
  list
  map
  memory
  mutex
  optional
  ostream
  queue
  random
  regex
  set
  shared_mutex
  sstream
  stack
  stdexcept
  streambuf
  string
  string_view
  thread
  tuple
  typeinfo
  unordered_map
  unordered_set
  utility
  variant
  vector
)

file(GLOB_RECURSE core_files
  "${CORE_DIR}/*.hpp"
  "${CORE_DIR}/*.cpp"
  "${CORE_DIR}/*.c"
)

set(found "")
foreach(f IN LISTS core_files)
  file(READ "${f}" content)
  foreach(h IN LISTS banned_headers)
    # Allow whitespace variations: # include <vector>
    if (content MATCHES "#[ \t]*include[ \t]*<${h}>")
      string(APPEND found "  ${f}: includes <${h}>\n")
    endif()
  endforeach()
endforeach()

if (NOT "${found}" STREQUAL "")
  message(FATAL_ERROR
    "STL headers are not allowed in cpp/rs/** (freestanding core contract):\n${found}"
  )
endif()
]=])

add_custom_target(rs_core_stl_guard
    COMMAND ${CMAKE_COMMAND} -DCORE_DIR=${CMAKE_CURRENT_SOURCE_DIR}/rs -P "${RS_CORE_STL_GUARD_SCRIPT}"
    VERBATIM
)

add_dependencies(rs rs_core_stl_guard)

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

    if (EMSCRIPTEN)
        # Browser-only: no filesystem, and explicitly export the C API surface.
        target_link_options(rs_wasm_smoke PRIVATE
            -sENVIRONMENT=web
            -sFILESYSTEM=0
        )
    endif()
endif()
