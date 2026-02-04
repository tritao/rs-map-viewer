#define XXH_STATIC_LINKING_ONLY
#define XXH_IMPLEMENTATION
#include "../../third_party/xxhash/xxhash.h"

#include "XXHash64.hpp"

#include <cstddef>

#include "../types.hpp"

namespace rs {

u64 xxh64(const void* data, std::size_t len) {
    return static_cast<u64>(XXH64(data, len, 0));
}

} // namespace rs
