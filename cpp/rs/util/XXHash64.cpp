#define XXH_STATIC_LINKING_ONLY
#define XXH_IMPLEMENTATION
#include "../../third_party/xxhash/xxhash.h"

#include "XXHash64.hpp"

#include <cstddef>
#include <ios>
#include <sstream>
#include <string>

#include "../types.hpp"

namespace rs {

u64 xxh64(const void* data, std::size_t len) {
    return static_cast<u64>(XXH64(data, len, 0));
}

std::string h64Hex(u64 v) {
    std::ostringstream oss;
    oss.setf(std::ios::hex, std::ios::basefield);
    oss.width(16);
    oss.fill('0');
    oss << static_cast<unsigned long long>(v);
    return oss.str();
}

} // namespace rs
