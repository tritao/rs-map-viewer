#pragma once

#include <cstddef>

#include "Str.hpp"

namespace rs {

inline Str strLiteral(const char* s) noexcept {
    if (!s) {
        return Str{};
    }
    std::size_t n = 0;
    while (s[n] != '\0') {
        n++;
    }
    Str out{};
    out.data = s;
    out.len = n;
    return out;
}

inline char toLowerAscii(char c) noexcept {
    if (c >= 'A' && c <= 'Z') {
        return static_cast<char>(c + ('a' - 'A'));
    }
    return c;
}

inline bool equalsIgnoreCaseAscii(Str s, const char* lit) noexcept {
    if (!lit) {
        return s.len == 0;
    }
    std::size_t i = 0;
    for (; i < s.len; i++) {
        const char lc = lit[i];
        if (lc == '\0') {
            return false;
        }
        if (toLowerAscii(s.data[i]) != toLowerAscii(lc)) {
            return false;
        }
    }
    return lit[i] == '\0';
}

} // namespace rs

