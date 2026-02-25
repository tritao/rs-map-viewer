cmake_minimum_required(VERSION 3.20)

project(rs_cpp LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Needed for clang-tidy / include-cleaner linting.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(RS_BUILD_TOOLS "Build command-line tools (native only by default)" ON)
option(RS_BUILD_TESTS "Build tests (native only by default)" ON)
option(RS_BUILD_NATIVE_VIEWER "Build native OpenGL map viewer shell (GLFW)" ON)
option(RS_BUILD_WASM_SMOKE "Build a minimal wasm smoke target" OFF)
option(RS_BUILD_WASM_MAP_RENDER_BACKEND "Build wasm map-render backend module" OFF)
option(RS_ENABLE_SANITIZERS "Enable ASan+UBSan for native builds" OFF)

if (EMSCRIPTEN)
    # No CLI/tests for wasm yet (they depend on native filesystem + host execution).
    set(RS_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
    set(RS_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    # Default wasm bootstrap: build only the core static library (`librs.a`).
    # Enable RS_BUILD_WASM_SMOKE manually if you want a linked wasm executable wrapper.
    if (NOT RS_BUILD_WASM_SMOKE)
        set(RS_BUILD_WASM_SMOKE OFF CACHE BOOL "" FORCE)
    endif()
    if (NOT RS_BUILD_WASM_MAP_RENDER_BACKEND)
        set(RS_BUILD_WASM_MAP_RENDER_BACKEND OFF CACHE BOOL "" FORCE)
    endif()
endif()

set(RS_SOURCES
    rs/io/Uint8ArrayByteSource.cpp
    rs/io/Uint8ArrayReader.cpp
    rs/crypto/Xtea.cpp
    rs/compression/NativeCompressionHandler.cpp
    rs/cache/format/Container.cpp
    rs/cache/format/Archive.cpp
	    rs/cache/reference/ReferenceTable.cpp
	    rs/cache/store/SectorChainStore.cpp
	    rs/cache/CacheIndex.cpp
	    rs/cache/CacheSystem.cpp
	    rs/sprite/SpriteLoader.cpp
	    rs/texture/SpriteTextureLoader.cpp
	    rs/texture/DatTextureLoader.cpp
	    rs/texture/ProceduralTextureLoader.cpp
	    rs/texture/OldProceduralTextureLoader.cpp
	    rs/texture/procedural/TextureGenerator.cpp
	    rs/texture/procedural/ProceduralTexture.cpp
	    rs/texture/procedural/operation/TextureOperationFactory.cpp
	    rs/util/XXHash64.cpp
	    rs/util/HeightCalc.cpp
	    rs/map/TerrainSquareDecode.cpp
	    rs/map/LocPlacementsDecode.cpp
	    rs/map/NpcSpawnsDecode.cpp
	    rs/render/SceneBuffer.cpp
    rs/render/PackedVertex.cpp
    rs/render/PackedVertexDedupe.cpp
    rs/render/TerrainTileBuilder.cpp
    rs/render/TerrainTileSampler.cpp
	    rs/render/SceneCommandPack.cpp
	    rs/render/TerrainEmit.cpp
	    rs/render/LocEmit.cpp
	    rs/render/ObjEmit.cpp
	    rs/render/SceneCommandBuilder.cpp
	    rs/render/RuntimeCommandStreamPlan.cpp
	    rs/scene/SceneBuildStages.cpp
	    rs/scene/BuildSceneFromMapBytesProvider.cpp
	    tools/rs_scene_bridge.cpp
	    rs/loaders/ConfigLoaders.cpp
	    rs/loaders/CacheSession.cpp
	    rs/loaders/Dat2Loaders.cpp
	    rs/loaders/DatLoaders.cpp
	    rs/loaders/LegacyLoaders.cpp
	    rs/loaders/Loaders.cpp
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

if (RS_ENABLE_SANITIZERS AND NOT EMSCRIPTEN)
    set(RS_SANITIZER_FLAGS
        -fsanitize=address,undefined
        -fno-omit-frame-pointer
        -fno-sanitize-recover=all
        # `-fsanitize=undefined` enables `vptr` by default, which requires RTTI. The core library is built with
        # `-fno-rtti`, so we explicitly disable it here.
        -fno-sanitize=vptr
    )

    target_compile_options(rs PRIVATE
        ${RS_SANITIZER_FLAGS}
    )
endif()

if (RS_BUILD_TOOLS)
    add_executable(rs_cli
        tools/CliCacheOpen.cpp
        tools/rs_cli.cpp
    )

    target_link_libraries(rs_cli PRIVATE rs)

    if (RS_ENABLE_SANITIZERS AND NOT EMSCRIPTEN)
        target_compile_options(rs_cli PRIVATE ${RS_SANITIZER_FLAGS})
        target_link_options(rs_cli PRIVATE ${RS_SANITIZER_FLAGS})
    endif()

    target_link_options(rs_cli PRIVATE
        -Wl,--gc-sections
    )
endif()

if (RS_BUILD_NATIVE_VIEWER AND NOT EMSCRIPTEN)
    find_package(glfw3 QUIET)
    find_package(OpenGL QUIET)

    if ((TARGET glfw OR TARGET glfw3::glfw) AND OpenGL_FOUND)
        add_executable(rs_native_viewer
            tools/rs_native_viewer.cpp
        )

        target_link_libraries(rs_native_viewer PRIVATE rs OpenGL::GL)
        if (TARGET glfw3::glfw)
            target_link_libraries(rs_native_viewer PRIVATE glfw3::glfw)
        else()
            target_link_libraries(rs_native_viewer PRIVATE glfw)
        endif()

        target_link_options(rs_native_viewer PRIVATE
            -Wl,--gc-sections
        )
    else()
        message(STATUS "Skipping rs_native_viewer (requires glfw3 + OpenGL)")
    endif()
endif()

if (RS_BUILD_TESTS)
    enable_testing()

    add_executable(rs_tests
        tests/rs_tests.cpp
    )

    target_link_libraries(rs_tests PRIVATE rs)

    if (RS_ENABLE_SANITIZERS AND NOT EMSCRIPTEN)
        target_compile_options(rs_tests PRIVATE ${RS_SANITIZER_FLAGS})
        target_link_options(rs_tests PRIVATE ${RS_SANITIZER_FLAGS})
    endif()

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

if (RS_BUILD_WASM_MAP_RENDER_BACKEND)
    if (NOT EMSCRIPTEN)
        message(FATAL_ERROR "RS_BUILD_WASM_MAP_RENDER_BACKEND requires Emscripten")
    endif()

    add_executable(rs_map_render_backend
        tools/rs_map_render_backend.cpp
    )

    target_link_libraries(rs_map_render_backend PRIVATE rs)

    option(RS_MAP_RENDER_WASM_DEBUG_EXPORTS "Export debug-only runtime APIs in map-render wasm backend" OFF)

    set(RS_MAP_RENDER_EXPORTED_FUNCTIONS_CORE
        "['_malloc','_free','_rs_map_render_bridge_abi_version','_rs_map_render_bridge_capabilities','_rs_heightmap_from_scene_tile_heights','_rs_decode_npc_spawns_from_bytes','_rs_map_render_runtime_create','_rs_map_render_runtime_create_with_config','_rs_map_render_runtime_cache_set_build_config','_rs_map_render_runtime_destroy','_rs_map_render_runtime_reset','_rs_map_render_runtime_is_valid','_rs_map_render_runtime_cache_put_map_squares_packed','_rs_map_render_runtime_cache_put_type_blob','_rs_map_render_runtime_cache_put_type_entry','_rs_map_render_runtime_cache_clear_type_kind','_rs_map_render_runtime_collect_required_primary_type_ids','_rs_map_render_runtime_collect_required_expanded_type_ids','_rs_map_render_runtime_cache_set_varps','_rs_map_render_runtime_set_geometry_seed','_rs_map_render_runtime_clear_geometry_seed','_rs_map_render_runtime_cache_needs_type_upload','_rs_map_render_runtime_cache_clear_map_squares','_rs_map_render_runtime_cache_put_texture_argb','_rs_map_render_runtime_cache_clear_texture_argb','_rs_map_render_runtime_cache_put_material_params','_rs_map_render_runtime_cache_clear_material_params','_rs_map_render_runtime_cache_get_resource_counts','_rs_map_render_runtime_build_map_packet_handle_from_cache','_rs_map_render_runtime_build_npc_packet_handle_from_cache','_rs_map_render_runtime_get_packet_meta','_rs_map_render_runtime_release_packet','_rs_map_render_runtime_clear_tick_state','_rs_map_render_runtime_set_tick_state_packed','_rs_map_render_runtime_tick_advance_and_emit_base_patches_for_state_packed','_rs_map_render_runtime_debug_get_last_collision_flags_meta','_rs_map_render_runtime_debug_copy_last_collision_flags']"
    )

    set(RS_MAP_RENDER_EXPORTED_FUNCTIONS_DEBUG
        "'_rs_map_render_runtime_debug_collect_map_input_digest','_rs_map_render_runtime_debug_get_cache_config','_rs_map_render_runtime_debug_get_loaded_height_hash','_rs_map_render_runtime_debug_get_map_input_hashes','_rs_map_render_runtime_debug_get_cached_command_stream_digest','_rs_map_render_runtime_debug_get_cached_command_stream_lengths','_rs_map_render_runtime_debug_copy_cached_command_stream','_rs_map_render_runtime_debug_get_last_terrain_tile_face_counts_meta','_rs_map_render_runtime_debug_copy_last_terrain_tile_face_counts','_rs_map_render_runtime_debug_get_last_build_stats','_rs_map_render_runtime_debug_decode_overlay_type','_rs_map_render_runtime_debug_decode_loc_type'"
    )

    if (RS_MAP_RENDER_WASM_DEBUG_EXPORTS)
        string(REPLACE "']" "',${RS_MAP_RENDER_EXPORTED_FUNCTIONS_DEBUG}]" RS_MAP_RENDER_EXPORTED_FUNCTIONS "${RS_MAP_RENDER_EXPORTED_FUNCTIONS_CORE}")
    else()
        set(RS_MAP_RENDER_EXPORTED_FUNCTIONS "${RS_MAP_RENDER_EXPORTED_FUNCTIONS_CORE}")
    endif()

    target_compile_definitions(rs PRIVATE
        RS_SCENE_BRIDGE_NO_WASM_KEEPALIVE=1
    )
    target_compile_definitions(rs_map_render_backend PRIVATE
        RS_SCENE_BRIDGE_NO_WASM_KEEPALIVE=1
    )

    target_link_options(rs_map_render_backend PRIVATE
        -Wl,--gc-sections
        -sERROR_ON_UNDEFINED_SYMBOLS=1
        -sENVIRONMENT=web,worker,node
        -sFILESYSTEM=0
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sALLOW_MEMORY_GROWTH=1
        -sINITIAL_MEMORY=268435456
        -sMAXIMUM_MEMORY=1073741824
        --no-entry
        "-sEXPORTED_FUNCTIONS=${RS_MAP_RENDER_EXPORTED_FUNCTIONS}"
    )
endif()
