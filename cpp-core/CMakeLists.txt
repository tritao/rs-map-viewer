cmake_minimum_required(VERSION 3.20)

project(rs_core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

get_filename_component(RS_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(RS_FIXTURES_DIR "${RS_REPO_ROOT}/testdata/cache-fixtures")

add_executable(rs_core_tests
    tests/main.cpp
    src/rs_core/xtea.cpp
    src/rs_core/sector_chain_store.cpp
    src/rs_core/archive_split.cpp
)

target_include_directories(rs_core_tests PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

target_compile_definitions(rs_core_tests PRIVATE
    RS_FIXTURE_DIR="${RS_FIXTURES_DIR}"
)

enable_testing()
add_test(NAME rs_core_tests COMMAND rs_core_tests)

