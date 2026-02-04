#pragma once

#include <optional>
#include <span>
#include <vector>

#include "ByteSource.hpp"

namespace rs {

class ByteSourceAccess {
public:
    explicit ByteSourceAccess(ByteSourcePtr source);

    [[nodiscard]] ByteSourcePtr source() const { return source_; }

    [[nodiscard]] std::optional<std::span<const u8>> tryView(std::size_t offset, std::size_t length) const;
    [[nodiscard]] std::vector<u8> copyBytes(std::size_t offset, std::size_t length) const;

    void readInto(std::size_t offset, u8* target, std::size_t length) const;

private:
    ByteSourcePtr source_;
    std::optional<std::span<const u8>> view_;
};

} // namespace rs

